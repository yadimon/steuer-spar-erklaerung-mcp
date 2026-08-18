$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($functionName in @('New-SSESnapshotNodeIndex', 'Get-SSESnapshotParentLineageKey', 'Get-SSESnapshotPrivateComparisonKey', 'Compare-SSESnapshotNodes')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $functionName ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

# Fuer diesen isolierten Verhaltenstest genuegt der private JSON-String selbst
# als kollisionsfreier Schluessel. Produktiv wird er vor der Verwendung gehasht.
function Get-SSETextSha256([string]$Text) { $Text }
function Test-SSEScalarEqual($Actual, $Expected) { [string]$Actual -eq [string]$Expected }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node(
  [string]$Rid,
  [string]$Name = 'Privater Name',
  [string]$Value = 'Privater Wert',
  [string]$Type = 'Edit',
  [string]$Aid = '',
  [int]$Index = 4,
  [int]$Parent = 1,
  [int]$Depth = 2
) {
  [pscustomobject]@{
    i=$Index; p=$Parent; d=$Depth
    rid=$Rid; type=$Type; name=$Name; aid=$Aid
    x=20; y=30; w=200; h=24; on=$true; val=$Value; ro=$false
  }
}

$legacy = Node '1.2.3'
$bulkMitNeuerRid = Node '9.8.7'
$legacyKey = Get-SSESnapshotPrivateComparisonKey $legacy
$bulkKey = Get-SSESnapshotPrivateComparisonKey $bulkMitNeuerRid
Assert-True ($legacyKey -eq $bulkKey) "Private Vergleichsschluessel driften: '$legacyKey' != '$bulkKey'."
$churn = Compare-SSESnapshotNodes @($legacy) @($bulkMitNeuerRid)
Assert-True $churn.equivalent `
  "Semantisch identischer Knoten mit neuer RuntimeId gilt faelschlich als Abweichung: $($churn | ConvertTo-Json -Depth 5 -Compress)"
Assert-True ($churn.runtimeIdChurnCount -eq 1) 'RuntimeId-Wechsel wurde nicht ausdruecklich gezaehlt.'
Assert-True ($churn.missingCount -eq 0 -and $churn.extraCount -eq 0) 'RuntimeId-Wechsel erzeugte missing/extra.'

$changedValue = Compare-SSESnapshotNodes @($legacy) @((Node '1.2.3' 'Privater Name' 'Anderer privater Wert'))
Assert-True (-not $changedValue.equivalent -and $changedValue.valueMismatchCount -eq 1) `
  'Wertabweichung bei stabiler RuntimeId wurde verdeckt.'

$changedPrivateNode = Compare-SSESnapshotNodes @($legacy) @((Node '9.8.7' 'Privater Name' 'Anderer privater Wert'))
Assert-True (-not $changedPrivateNode.equivalent) 'Privatinhalt mit neuer RuntimeId wurde faelschlich gepaart.'
Assert-True ($changedPrivateNode.missingCount -eq 1 -and $changedPrivateNode.extraCount -eq 1) `
  'Echte unmatched-Knoten wurden nicht als missing/extra gemeldet.'
$safeSamples = $changedPrivateNode.samples | ConvertTo-Json -Depth 5 -Compress
Assert-True (-not $safeSamples.Contains('Privater Name') -and -not $safeSamples.Contains('Privater Wert')) `
  'Snapshot-Vergleich gab private Namen oder Werte in Samples aus.'

$changedMetadata = Compare-SSESnapshotNodes @($legacy) @((Node '1.2.3' 'Anderer Name'))
Assert-True (-not $changedMetadata.equivalent -and $changedMetadata.metadataMismatchCount -eq 1) `
  'Metadatenabweichung bei stabiler RuntimeId wurde verdeckt.'

$movedParent = Compare-SSESnapshotNodes @($legacy) @((Node '9.8.7' 'Privater Name' 'Privater Wert' 'Edit' '' 4 3 2))
Assert-True (-not $movedParent.equivalent -and $movedParent.runtimeIdChurnCount -eq 0) `
  'Knoten mit neuer RuntimeId unter anderem Elternknoten wurde faelschlich gepaart.'
Assert-True ($movedParent.missingCount -eq 1 -and $movedParent.extraCount -eq 1) `
  'Elternstruktur-Abweichung wurde nicht als missing/extra gemeldet.'

$movedDepth = Compare-SSESnapshotNodes @($legacy) @((Node '9.8.7' 'Privater Name' 'Privater Wert' 'Edit' '' 4 1 3))
Assert-True (-not $movedDepth.equivalent -and $movedDepth.runtimeIdChurnCount -eq 0) `
  'Knoten mit neuer RuntimeId auf anderer Tiefe wurde faelschlich gepaart.'

$stableRidMovedParent = Compare-SSESnapshotNodes @($legacy) @((Node '1.2.3' 'Privater Name' 'Privater Wert' 'Edit' '' 4 3 2))
Assert-True (-not $stableRidMovedParent.equivalent -and $stableRidMovedParent.metadataMismatchCount -eq 1) `
  'Knoten mit stabiler RuntimeId unter anderem Elternknoten wurde faelschlich als aequivalent gemeldet.'
$stableRidMovedDepth = Compare-SSESnapshotNodes @($legacy) @((Node '1.2.3' 'Privater Name' 'Privater Wert' 'Edit' '' 4 1 3))
Assert-True (-not $stableRidMovedDepth.equivalent -and $stableRidMovedDepth.metadataMismatchCount -eq 1) `
  'Knoten mit stabiler RuntimeId auf anderer Tiefe wurde faelschlich als aequivalent gemeldet.'
$stableRidShiftedIndex = Compare-SSESnapshotNodes @($legacy) @((Node '1.2.3' 'Privater Name' 'Privater Wert' 'Edit' '' 5 1 2))
Assert-True ($stableRidShiftedIndex.equivalent -and $stableRidShiftedIndex.metadataMismatchCount -eq 0) `
  'Reine Traversal-Indexverschiebung wurde faelschlich als Strukturabweichung gemeldet.'

$parentA = Node '10' 'Parent A' '' 'Group' 'parent-a' 0 -1 0
$parentB = Node '11' 'Parent B' '' 'Group' 'parent-b' 1 -1 0
$child = Node '12' 'Privater Name' 'Privater Wert' 'Edit' '' 2 0 1
$sameTreeWithChurn = Compare-SSESnapshotNodes @($parentA, $parentB, $child) @(
  (Node '10' 'Parent A' '' 'Group' 'parent-a' 0 -1 0),
  (Node '11' 'Parent B' '' 'Group' 'parent-b' 1 -1 0),
  (Node '99' 'Privater Name' 'Privater Wert' 'Edit' '' 2 0 1)
)
Assert-True ($sameTreeWithChurn.equivalent -and $sameTreeWithChurn.runtimeIdChurnCount -eq 1) `
  'RuntimeId-Churn im selben Slot eines gueltigen Baums wurde nicht versoehnt.'
$reparentedTree = Compare-SSESnapshotNodes @($parentA, $parentB, $child) @(
  (Node '10' 'Parent A' '' 'Group' 'parent-a' 0 -1 0),
  (Node '11' 'Parent B' '' 'Group' 'parent-b' 1 -1 0),
  (Node '99' 'Privater Name' 'Privater Wert' 'Edit' '' 2 1 1)
)
Assert-True (-not $reparentedTree.equivalent -and $reparentedTree.missingCount -eq 1 -and $reparentedTree.extraCount -eq 1) `
  'Reparenting in einem gueltigen Baum wurde durch RuntimeId-Churn maskiert.'
$stableRidReparentedTree = Compare-SSESnapshotNodes @($parentA, $parentB, $child) @(
  (Node '10' 'Parent A' '' 'Group' 'parent-a' 0 -1 0),
  (Node '11' 'Parent B' '' 'Group' 'parent-b' 1 -1 0),
  (Node '12' 'Privater Name' 'Privater Wert' 'Edit' '' 2 1 1)
)
Assert-True (-not $stableRidReparentedTree.equivalent -and
    $stableRidReparentedTree.metadataMismatchCount -eq 1 -and
    $stableRidReparentedTree.missingCount -eq 0 -and $stableRidReparentedTree.extraCount -eq 0) `
  'Reparenting mit stabiler RuntimeId wurde in einem gueltigen Baum nicht als Metadatenabweichung erkannt.'

Write-Output 'Snapshot-Vergleich: RuntimeId-Churn gepaart, echte private Struktur-/Wertabweichungen fail-closed.'
