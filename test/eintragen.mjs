/**
 * Historischer Direkt-Schreibhelfer, absichtlich stillgelegt.
 *
 * Tabellenzeilen duerfen nicht mehr zellenweise ueber RuntimeIds geschrieben
 * werden: Zwischen zwei Zellen koennen Seite, Scrollposition, Summenregion
 * oder Benutzerzustand wechseln. Fuer reale Eintraege sse_table_add mit
 * expectedPage, sumLabel, expectedBefore und expectedAfter verwenden; fuer
 * Regressionen test/table-lifecycle-transaction.mjs.
 */
process.stderr.write(
  "GESPERRT: Der alte zellenweise Direkt-Schreibtest ist unsicher. " +
  "Verwende sse_table_add mit Seiten- und Summenvertrag.\n",
);
process.exit(2);
