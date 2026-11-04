# Research — validation false positives (v0.6.0)

Reference project (not committed, measurement only):
`D:\workspace\01_VW_ComVeh\00_BC_ComVeh\00_ScoutREX\DMG1311VX1A2848_M29A30_COM1015_1_0_ST528`

Method: build the v0.6.0 `IndexBuilder` / `WorkspaceIndex` over every `.arxml` (streamed, 50 MB limit,
same defaults as `indexService`), then call `validateWorkspace` with `DEFAULT_SEVERITIES`. Sources were
checked out at tag `v0.6.0` in a temporary worktree, bundled with the repo's esbuild, run on Node 26.

## Baseline

```
files 1,594   bytes 359 MB   index build 11 s
elements 229,499   references 36,120   definitions 17,225   packages 6,806
diagnostics 61,566

brokenReference     18,165
duplicateShortName  18,046
multiplicity        17,935
missingDefinition    5,091
missingRequired      1,689
valueOutOfRange        640
destMismatch             0
```

## Per-rule evidence

### brokenReference

```
ECUC-CONTAINER-VALUE            16,170   ambiguous 16,167 / absent 3
SW-ADDR-METHOD                     710
BSW-IMPLEMENTATION                 369
IMPLEMENTATION-DATA-TYPE           220
BSW-MODULE-ENTRY                   153
UNIT                               136
ECUC-MODULE-CONFIGURATION-VALUES   117
COMPU-METHOD                       112
other non-ECUC DESTs              ~1,100
```

`indexBuilder.isDefinitionKind` records only ECUC `*-DEF` and `ECUC-*-VALUE` elements. Packages such as
`/AUTOSAR_Platform/ImplementationDataTypes`, `SwAddrMethods`, `BswModuleEntrys` and `CompuMethods` exist
in the workspace but are invisible to the index, so those references can never resolve.

Ambiguity comes from identical AR paths in source files and generated copies (`_fwd`, `_out`, `_gen`).
Resolution preference measured on the ambiguous set:

| policy | resolved |
|---|---|
| candidate in the referencing file | 7,960 |
| then candidate outside `_fwd`/`_out`/`_gen` | 7,653 |
| still ambiguous | 664 |

Only **11** ECUC targets are genuinely absent.

### duplicateShortName

8,072 duplicate paths → 18,046 diagnostics (one per element). 7,325 paths are cross-file copies, mostly
`_fwd\ecuc_configuration_values_fwd.arxml` + per-module source. 747 are same-file, 688 of them inside
`_fwd` (real repeated siblings, e.g. `ecy_TB_CFG` ×13, `LamSigHtr_OSIC_Stage0` ×15).

### multiplicity

17,588 of 17,935 groups are inflated: the same parent path exists in two files, so both copies' children
are summed (`CanTpRxNPdu`: `_fwd` 1 + `cantp_obd_ecucvalues` 1 = 2, definition allows 1).

### missingDefinition

5,091 diagnostics over **81 distinct** definitions. Genuine: `/AUTOSAR_ComM/EcucModuleDefs/ComM/ComMConfigSet/ComMUser`
has no `SHORT-NAME` anywhere in the workspace. Cascades: when a module-definition file is absent, its
root path and every child path are reported (e.g. `/RB/RBA/rba_Nds/...`, 1,974 hits).

### missingRequired

1,644 of 1,689 come from `ECUC-ADD-INFO-PARAM-DEF` children (documentation fields such as
`DemRbDocFailedCriteria`, lower multiplicity 1) that generated configs legitimately omit — 12 distinct
definition pairs.

### valueOutOfRange

615 boolean params hold `<VALUE>0</VALUE>`/`<VALUE>1</VALUE>`; 24 integer params hold `<VALUE></VALUE>`
("use default"); 1 genuine range hit.

## Effect of excluding generated trees

Skipping `**/_fwd/**`, `**/_out/**`, `**/_gen/**` (1,234 of 1,594 files remain):

```
diagnostics 17,193
duplicateShortName  6,946  (3,063 paths: 63 same-file, 3,000 cross-file)
missingDefinition   4,724  (73 distinct)
brokenReference     2,592  (467 non-ECUC, 2,077 ambiguous, 48 absent)
multiplicity        1,873  (217 with per-file counting)
missingRequired       982
valueOutOfRange        76
```

## Expected result after the fix

- `brokenReference`: 2,592 → ~1,200 with exclusion, ~700 of them true duplicates; 11 truly broken.
- `duplicateShortName`: 6,946 → 3,063 (one per path).
- `missingDefinition`: 4,724 → 73.
- `multiplicity`: 1,873 → 217.
- `missingRequired`: 982 → ~40.
- `valueOutOfRange`: 76 → ~2.

Without the exclusion setting the counts stay higher because the workspace really does contain copies;
the structural false positives (non-ECUC refs, summed multiplicity, ADD-INFO, empty values) disappear in
both cases.

## Synthetic probes (no customer data)

These reproduce the same classes in small fixtures and are the basis for the acceptance tests:

| Probe | v0.6.0 result | Cause |
|---|---|---|
| Two folders with identical AR paths and the same module definition | error `duplicateShortName`, `brokenReference` ambiguous, `multiplicity` warning | path-only identity, summed counts across files, no DEST filter |
| Boolean parameter `<VALUE>1</VALUE>` | `valueOutOfRange: is not a boolean` | boolean accepts only `true`/`false` |
| Float parameter `<VALUE>INF</VALUE>` | `valueOutOfRange: is not a valid float` | `Number.isFinite` rejects AUTOSAR `INF` |
| Empty integer `<VALUE></VALUE>` | `valueOutOfRange: is not a valid integer` | empty treated as a value, not "default" |
| Required parameter with `DEFAULT-VALUE` absent from the instance | `missingRequired` | default value ignored |
| Two definitions at the same path | Details shows nothing | `definitionEntry` returns `undefined` without a count |

## Measured cost of the validation pass

v0.6.0 `validateWorkspace` on a 42 MB synthetic index: ~1.1 s, synchronous, after every index change.
The v0.6.1 benchmark records the same shape at ~40 MiB with explicit time and heap budgets.
