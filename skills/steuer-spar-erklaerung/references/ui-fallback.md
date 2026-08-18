# Fallback bei unbekannten Controls

Lies diese Referenz nur, wenn für ein benötigtes SSE-Control keine passende
Spezialoperation verfügbar ist.

1. Lies zuerst `sse_page_state` oder `sse_ui_state`.
2. Entdecke das Control ausschließlich lesend mit `sse_snapshot`, `sse_find`
   und bei Bedarf `sse_accessibility_probe`.
3. Übernimm AutomationId oder RuntimeId nur aus diesem frischen Zustand. Für
   eine Aktion ist der Name oder die AutomationId die bessere Bindung: Ältere
   Programmversionen vergeben zwischen zwei Aufrufen neue RuntimeIds, und die
   Aktion endet dann mit `not-found` auf einem leeren Bezeichner.
4. Verwende für Checkboxen `sse_toggle`, für Listen `sse_combo_options` plus
   `sse_combo_select` und für Textfelder eine gebundene Schreiboperation.
5. Verwende `sse_click` nur, wenn Ziel, Seite, Fenster und Nachbedingung
   eindeutig sind. Nutze niemals einen generischen Toggle-Klick.
6. Lies nach jeder Interaktion den Zustand neu. Bei Mehrdeutigkeit oder
   Abweichung stoppen; nicht auf eine andere Methode durchprobieren.

Ein unbekannter Dialogbutton wird in `unsupportedButtons` gemeldet, bleibt aber
gesperrt. Zeige ihn dem Nutzer und stoppe. Erweitere die Allowlist nicht zur
Laufzeit und bestätige keine Dialogkette blind.
