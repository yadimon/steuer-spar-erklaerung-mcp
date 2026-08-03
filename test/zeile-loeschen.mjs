/**
 * Historischer Roh-Tastatur-Löschhelfer, absichtlich stillgelegt.
 *
 * Reale Löschungen ausschließlich über sse_table_delete mit expectedPage,
 * exaktem Zeilentext, sumLabel sowie expectedBefore/expectedAfter. Der
 * Regressionstest test/table-delete-transaction.mjs belegt den sicheren
 * Vor-Mutationsabbruch, solange das SSE-Fenster nicht auf dem aktiven
 * Windows-Desktop klickbar ist.
 */
process.stderr.write(
  "GESPERRT: Verwende sse_table_delete mit Seiten-, Ziel- und Summenvertrag; " +
  "Roh-Tastaturloeschen ist entfernt.\n",
);
process.exit(2);
