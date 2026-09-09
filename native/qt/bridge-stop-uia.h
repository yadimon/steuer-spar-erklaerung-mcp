// External, focusless UI Automation client. Each provider call and tree walk is bounded.
#include <objbase.h>
#include <UIAutomationClient.h>
#include <wrl/client.h>
#include <functional>
#include <set>
using Microsoft::WRL::ComPtr;
using StopClock = std::chrono::steady_clock;
static void stopChecked(HRESULT result, const char *phase) {
    if (FAILED(result)) throw DiscoveryError("state-unknown", (std::string("UI Automation read failed: ") + phase).c_str());
}
struct StopBstr {
    BSTR value = nullptr;
    ~StopBstr() { SysFreeString(value); }
    std::wstring text() const {
        const auto size = value ? SysStringLen(value) : 0;
        if (size > 4096) throw DiscoveryError("state-unknown", "UI Automation string exceeds its bound");
        return size ? std::wstring(value, size) : std::wstring();
    }
};
struct StopApartment {
    StopApartment() { stopChecked(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "COM initialization"); }
    ~StopApartment() { CoUninitialize(); }
};
struct StopElement {
    ComPtr<IUIAutomationElement> element;
    std::wstring name, aid;
    int type = 0;
    bool enabled = false;
};
struct StopTree {
    std::vector<StopElement> elements;
    Json state = Json::array();
};
struct StopAutomation {
    StopApartment apartment;
    ComPtr<IUIAutomation2> automation;
    ComPtr<IUIAutomationCacheRequest> cache;
    ComPtr<IUIAutomationTreeWalker> walker;
    DWORD pid;
    StopClock::time_point deadline;
    explicit StopAutomation(DWORD process, StopClock::time_point limit) : pid(process), deadline(limit) {
        stopChecked(CoCreateInstance(CLSID_CUIAutomation8, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation)), "client creation");
        stopChecked(automation->put_ConnectionTimeout(1000), "connection timeout");
        stopChecked(automation->put_TransactionTimeout(1000), "transaction timeout");
        stopChecked(automation->CreateCacheRequest(&cache), "cache creation");
        stopChecked(cache->put_TreeScope(TreeScope_Element), "cache scope");
        for (const auto property : {UIA_NamePropertyId, UIA_AutomationIdPropertyId, UIA_ControlTypePropertyId,
            UIA_ProcessIdPropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId})
            stopChecked(cache->AddProperty(property), "cache property");
        stopChecked(automation->get_ControlViewWalker(&walker), "control walker");
    }
    void checkTime() const {
        if (StopClock::now() >= deadline) throw DiscoveryError("state-unknown", "UI Automation read deadline expired");
    }
    StopElement describe(ComPtr<IUIAutomationElement> element) const {
        checkTime(); StopBstr name, aid; int process = 0, type = 0; BOOL enabled = FALSE, offscreen = TRUE;
        stopChecked(element->get_CachedProcessId(&process), "element process");
        stopChecked(element->get_CachedName(&name.value), "element name");
        stopChecked(element->get_CachedAutomationId(&aid.value), "element automation ID");
        stopChecked(element->get_CachedControlType(&type), "element type");
        stopChecked(element->get_CachedIsEnabled(&enabled), "element enabled");
        stopChecked(element->get_CachedIsOffscreen(&offscreen), "element visibility");
        if (process != static_cast<int>(pid)) throw DiscoveryError("ownership", "UI Automation element belongs to another process");
        return {element, name.text(), aid.text(), type, enabled != FALSE && offscreen == FALSE};
    }
    StopTree tree(HWND hwnd) {
        checkTime(); StopTree result; ComPtr<IUIAutomationElement> root;
        stopChecked(automation->ElementFromHandleBuildCache(hwnd, cache.Get(), &root), "dialog root");
        if (!root) throw DiscoveryError("state-unknown", "Dialog root is unavailable");
        // Cache one element at a time; never ask an untrusted provider for an unbounded subtree.
        std::function<void(ComPtr<IUIAutomationElement>, int)> visit = [&](ComPtr<IUIAutomationElement> current, int depth) {
            checkTime();
            if (result.elements.size() >= 1200 || depth > 12)
                throw DiscoveryError("state-unknown", "Dialog tree exceeds its read bound");
            const auto item = describe(current);
            result.state.push_back({{"name", narrow(item.name)}, {"aid", narrow(item.aid)},
                {"type", item.type}, {"enabled", item.enabled}, {"depth", depth}});
            result.elements.push_back(item);
            ComPtr<IUIAutomationElement> child;
            stopChecked(walker->GetFirstChildElementBuildCache(current.Get(), cache.Get(), &child), "first child");
            while (child) {
                visit(child, depth + 1); checkTime(); ComPtr<IUIAutomationElement> sibling;
                stopChecked(walker->GetNextSiblingElementBuildCache(child.Get(), cache.Get(), &sibling), "next sibling");
                child = sibling;
            }
        };
        visit(root, 0); return result;
    }
    Json dirty(HWND hwnd) {
        checkTime(); ComPtr<IUIAutomationElement> root;
        stopChecked(automation->ElementFromHandle(hwnd, &root), "main root");
        if (!root) return nullptr;
        StopBstr aid; stopChecked(root->get_CurrentAutomationId(&aid.value), "main automation ID");
        const auto exact = aid.text() + L".MainToolBar.tb_sichern";
        VARIANT value; VariantInit(&value); value.vt = VT_BSTR;
        value.bstrVal = SysAllocStringLen(exact.data(), static_cast<UINT>(exact.size()));
        if (!value.bstrVal) throw DiscoveryError("state-unknown", "Automation ID allocation failed");
        ComPtr<IUIAutomationCondition> condition;
        const auto status = automation->CreatePropertyCondition(UIA_AutomationIdPropertyId, value, &condition);
        VariantClear(&value); stopChecked(status, "exact save condition");
        ComPtr<IUIAutomationElement> button; checkTime();
        stopChecked(root->FindFirstBuildCache(TreeScope_Descendants, condition.Get(), cache.Get(), &button), "exact save lookup");
        if (!button) return nullptr;
        const auto item = describe(button);
        if (item.aid != exact) throw DiscoveryError("ownership", "Save button automation ID changed");
        // Dirty state follows IsEnabled even when the toolbar is outside the visible area.
        BOOL enabled = FALSE; stopChecked(button->get_CurrentIsEnabled(&enabled), "fresh save state");
        return enabled != FALSE;
    }
    ComPtr<IUIAutomationInvokePattern> invokePattern(const StopElement &item) {
        checkTime(); BOOL enabled = FALSE, offscreen = TRUE; int process = 0; StopBstr name, aid;
        stopChecked(item.element->get_CurrentProcessId(&process), "fresh button process");
        stopChecked(item.element->get_CurrentName(&name.value), "fresh button name");
        stopChecked(item.element->get_CurrentAutomationId(&aid.value), "fresh button automation ID");
        stopChecked(item.element->get_CurrentIsEnabled(&enabled), "fresh button enabled");
        stopChecked(item.element->get_CurrentIsOffscreen(&offscreen), "fresh button visibility");
        if (process != static_cast<int>(pid) || name.text() != item.name || aid.text() != item.aid || !enabled || offscreen)
            throw DiscoveryError("state-unknown", "Dialog button changed before invocation");
        ComPtr<IUIAutomationInvokePattern> pattern;
        stopChecked(item.element->GetCurrentPatternAs(UIA_InvokePatternId, IID_PPV_ARGS(&pattern)), "button invoke pattern");
        if (!pattern) throw DiscoveryError("state-unknown", "Dialog button has no focusless invoke pattern");
        return pattern;
    }
};
