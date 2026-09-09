static bool sameProcessUser(HANDLE process) {
    HANDLE ownRaw = nullptr, otherRaw = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &ownRaw)) return false;
    Handle own(ownRaw);
    if (!OpenProcessToken(process, TOKEN_QUERY, &otherRaw)) return false;
    Handle other(otherRaw);
    DWORD ownSize = 0, otherSize = 0;
    GetTokenInformation(own.value, TokenUser, nullptr, 0, &ownSize);
    GetTokenInformation(other.value, TokenUser, nullptr, 0, &otherSize);
    if (!ownSize || !otherSize) return false;
    std::vector<char> ownInfo(ownSize), otherInfo(otherSize);
    if (!GetTokenInformation(own.value, TokenUser, ownInfo.data(), ownSize, &ownSize)
        || !GetTokenInformation(other.value, TokenUser, otherInfo.data(), otherSize, &otherSize)) return false;
    return EqualSid(reinterpret_cast<TOKEN_USER*>(ownInfo.data())->User.Sid,
        reinterpret_cast<TOKEN_USER*>(otherInfo.data())->User.Sid) != FALSE;
}
static DWORD WINAPI serve(void *rawSession) {
    struct Retired { ~Retired() { started = false; } } retired;
    auto *argument = static_cast<std::shared_ptr<NativeSession>*>(rawSession);
    auto session = std::move(*argument); delete argument;
    const auto pipe = session->pipe;
    bool releaseRequested = false;
    while (ownerAlive(session)) {
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED connect{}; connect.hEvent = event.value;
        const BOOL immediate = ConnectNamedPipe(pipe, &connect);
        const DWORD connectionError = immediate ? ERROR_SUCCESS : GetLastError();
        if (!immediate && connectionError == ERROR_IO_PENDING) {
            HANDLE waits[]{event.value, session->owner};
            if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) != WAIT_OBJECT_0) {
                CancelIoEx(pipe, &connect); DWORD unused = 0; GetOverlappedResult(pipe, &connect, &unused, TRUE); break;
            }
            DWORD unused = 0;
            if (!GetOverlappedResult(pipe, &connect, &unused, FALSE)) break;
        } else if (!immediate && connectionError != ERROR_PIPE_CONNECTED) break;
        DWORD clientPid = 0;
        if (!ownerAlive(session) || !GetNamedPipeClientProcessId(pipe, &clientPid)
            || clientPid != session->binding.ownerProcessId) {
            DisconnectNamedPipe(pipe); continue;
        }
        while (ownerAlive(session)) {
            DWORD size = 0;
            // An idle owned connection has no expiry. Once a frame starts,
            // its remaining header/body stay bounded; owner death still cancels the wait.
            if (!transfer(pipe, &size, 1, false, releaseRequested ? 2500 : INFINITE, session->owner)
                || !transfer(pipe, reinterpret_cast<BYTE*>(&size) + 1, sizeof(size) - 1, false, 2500, session->owner)
                || size == 0 || size > 1048576) break;
            std::string frame(size, '\0');
            if (!transfer(pipe, frame.data(), size, false, 2500, session->owner)) break;
            const auto before = Clock::now();
            Json result, requestId; bool release = false, mutation = false, dispatched = false;
            try {
                auto request = Json::parse(frame);
                if (request.contains("id")) requestId = request["id"];
                if (request.value("nonce", "") != session->binding.nonce) result = noMutationError("UNAUTHORIZED", "Invalid session nonce");
                else if (releaseRequested) result = noMutationError("SESSION_RELEASING", "This session has released its authority; close the transport");
                else if (request.value("op", "") == "mutation_ack") {
                    const auto receipt = session->pendingReceipt.load();
                    if (receipt == 0 || request.value("receipt", std::string()) != std::to_string(receipt))
                        result = noMutationError("INVALID_MUTATION_RECEIPT", "No matching mutation result is awaiting acknowledgment in this session");
                    else {
                        // The owner accepted this exact result. This does not
                        // clear an already-latched recovery requirement.
                        session->pendingReceipt = 0; session->uncertainMutation = false;
                        result = {{"ok", true}, {"acknowledged", true}, {"receipt", std::to_string(receipt)}, {"mutationAttempted", false}};
                    }
                }
                else if (request.value("op", "") == "session_release") {
                    if (session->pendingReceipt != 0) result = noMutationError("MUTATION_ACK_REQUIRED", "Accept the pending mutation result before releasing this session");
                    else if (activeGuiRequests != 0) result = noMutationError("SESSION_DRAINING", "A native GUI request is still draining; its result must be inspected");
                    else { result = {{"ok", true}, {"released", true}, {"mutationAttempted", false}}; release = true; }
                } else {
                    mutation = isMutation(request.value("op", std::string()));
                    if (mutation && session->pendingReceipt != 0) {
                        result = error("MUTATION_ACK_REQUIRED", "Accept the pending mutation result before another mutation");
                        result["mutationAttempted"] = false;
                    } else {
                        if (mutation) session->uncertainMutation = true;
                        dispatched = true;
                        result = dispatch(request, session);
                        if (mutation && result.value("mutationAttempted", true) == false) session->uncertainMutation = false;
                        else if (mutation && result.value("outcomeUnknown", false)) recoveryRequired = true;
                        else if (mutation) {
                            const auto receipt = nextMutationReceipt.fetch_add(1);
                            if (receipt == 0) { recoveryRequired = true; throw std::runtime_error("Mutation receipt space exhausted; inspect the outcome"); }
                            session->pendingReceipt = receipt;
                            result["mutationReceipt"] = std::to_string(receipt);
                        }
                    }
                }
            } catch (const std::exception &e) {
                result = noMutationError("INVALID_REQUEST", e.what());
                if (mutation && dispatched) {
                    result["mutationAttempted"] = true; result["outcomeUnknown"] = true;
                    session->uncertainMutation = true; recoveryRequired = true;
                }
            }
            if (!requestId.is_null()) result["id"] = requestId;
            result["serverMs"] = elapsed(before);
            auto response = result.dump();
            if (response.size() > MAX_FRAME) response = error("RESPONSE_TOO_LARGE", "Response exceeds the protocol bound").dump();
            size = static_cast<DWORD>(response.size());
            if (!transfer(pipe, &size, sizeof(size), true, 2500, session->owner)
                || !transfer(pipe, response.data(), size, true, 2500, session->owner)) break;
            // WriteFile can complete into a buffer the owner has not consumed.
            // Only mutation_ack clears an attempted mutation's receipt obligation.
            // Do not discard a response still buffered in the pipe. The client
            // closes after reading this reply; EOF retires the session below.
            if (release) releaseRequested = true;
        }
        if (releaseRequested) session->released = true;
        if (session->uncertainMutation) recoveryRequired = true;
        DisconnectNamedPipe(pipe);
    }
    if (session->uncertainMutation) recoveryRequired = true;
    // Stop accepting work even when a cancelled or running callback still holds this session.
    session->released = true;
    CloseHandle(session->pipe); session->pipe = INVALID_HANDLE_VALUE;
    // The owner handle stays alive until all queued callbacks have discarded the session.
    return 0;
}

extern "C" __declspec(dllexport) DWORD WINAPI BridgeStart(void *raw) {
    std::lock_guard<std::mutex> lock(startMutex);
    if (!raw || started) return 1;
    if (activeGuiRequests != 0) return 14;
    const auto candidate = *static_cast<BridgeConfig*>(raw);
    FILETIME created{}, exited{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) return 2;
    const auto creationTime = (std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    DWORD windowOwner = 0;
    const auto hwnd = reinterpret_cast<HWND>(candidate.window);
    if (candidate.magic != 0x53534542 || candidate.version != 2 || candidate.processId != GetCurrentProcessId()
        || candidate.creationTime != creationTime || !IsWindow(hwnd)
        || !GetWindowThreadProcessId(hwnd, &windowOwner) || windowOwner != GetCurrentProcessId()
        || std::strcmp(qVersion(), "6.9.2") != 0 || !QCoreApplication::instance()
        || candidate.pipe[159] != 0 || candidate.nonce[64] != 0 || std::strlen(candidate.nonce) != 64
        || std::wcsncmp(candidate.pipe, L"\\\\.\\pipe\\sse-qt-read-", 21) != 0
        || candidate.ownerProcessId == 0 || candidate.ownerProcessId == GetCurrentProcessId()) return 3;
    const auto session = std::make_shared<NativeSession>();
    session->binding = candidate;
    session->owner = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, candidate.ownerProcessId);
    DWORD ownSession = 0, ownerSession = 0;
    if (!session->owner || WaitForSingleObject(session->owner, 0) != WAIT_TIMEOUT
        || !GetProcessTimes(session->owner, &created, &exited, &kernel, &user)
        || ((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime) != candidate.ownerCreationTime
        || !ProcessIdToSessionId(GetCurrentProcessId(), &ownSession)
        || !ProcessIdToSessionId(candidate.ownerProcessId, &ownerSession) || ownSession != ownerSession
        || !sameProcessUser(session->owner)) return 12;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&BridgeStart), &pinned)) return 4;
    auto *security = privateSecurity();
    if (!security) return 10;
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), security, FALSE};
    session->pipe = CreateNamedPipeW(candidate.pipe, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, &attributes);
    LocalFree(security);
    if (session->pipe == INVALID_HANDLE_VALUE) return 11;
    config = candidate;
    ++generation;
    started = true;
    auto *argument = new std::shared_ptr<NativeSession>(session);
    Handle thread(CreateThread(nullptr, 0, serve, argument, 0, nullptr));
    if (!thread.value) { delete argument; started = false; return 5; }
    return 0;
}
extern "C" __declspec(dllexport) DWORD WINAPI BridgeState(void*) {
    return (started ? 1u : 0u) | (recoveryRequired ? 2u : 0u)
        | (static_cast<DWORD>(activeGuiRequests.load()) << 8);
}
