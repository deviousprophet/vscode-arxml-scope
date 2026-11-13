//! ECUC ordering: `sort all` plus the exception list.
//!
//! The legacy key is `DEFINITION-REF + '"' + identity + '"'`, or `DEFINITION-REF`
//! alone for exception entries. Implemented as the tuple `(definitionRef, identity)`
//! with an empty identity for exception entries. Sorting is per list and never
//! merges parameters with references; the sort is stable, so equal keys keep the
//! authored order.

use super::model::{last_short_name, ContainerNode, ModuleNode, ParameterNode, ReferenceNode};

/// The 15 entries hardcoded in the legacy `Arxml2Artext.cmd`, verbatim.
pub const SORT_EXCEPTIONS: [&str; 15] = [
    "DcmDspDidRef",
    "DcmDspRequestRoutineResultsOutSignal",
    "DcmDspStartRoutineInSignal",
    "DcmDspStartRoutineOutSignal",
    "DcmDspStopRoutineInSignal",
    "DcmDspStopRoutineOutSignal",
    "DcmArgumentRef",
    "DemDidDataElementClassRef",
    "DemExtendedDataRecordClassRef",
    "DemDataElementClassRef",
    "DemDidClassRef",
    "DemFreezeFrameRecordClassRef",
    "DemSPNClassRef",
    "EcuMDriverInitItem",
    "EcuMRbCallOutItem",
];

/// True when `mode` means the authored order.
pub fn is_declaration(mode: &str) -> bool {
    mode == "declaration"
}

fn key_of(definition_ref: &str, identity: &str, except: &[String]) -> (String, String) {
    let is_exception = except
        .iter()
        .any(|entry| entry == last_short_name(definition_ref));
    (
        definition_ref.to_string(),
        if is_exception {
            String::new()
        } else {
            identity.to_string()
        },
    )
}

/// Orders module indices; `declaration` returns the authored order.
pub fn order_modules(modules: &[ModuleNode], mode: &str, except: &[String]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..modules.len()).collect();
    if is_declaration(mode) {
        return indices;
    }
    let mut keyed: Vec<((String, String), usize)> = indices
        .drain(..)
        .map(|index| {
            (
                key_of(
                    &modules[index].definition_ref,
                    &modules[index].short_name,
                    except,
                ),
                index,
            )
        })
        .collect();
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    keyed.into_iter().map(|(_, index)| index).collect()
}

/// Orders container indices; `declaration` returns the authored order.
pub fn order_containers(containers: &[ContainerNode], mode: &str, except: &[String]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..containers.len()).collect();
    if is_declaration(mode) {
        return indices;
    }
    let mut keyed: Vec<((String, String), usize)> = indices
        .drain(..)
        .map(|index| {
            (
                key_of(
                    &containers[index].definition_ref,
                    &containers[index].short_name,
                    except,
                ),
                index,
            )
        })
        .collect();
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    keyed.into_iter().map(|(_, index)| index).collect()
}

/// Orders parameters and references independently, so the two lists never interleave.
pub fn order_members(
    parameters: &[ParameterNode],
    references: &[ReferenceNode],
    mode: &str,
    except: &[String],
) -> (Vec<usize>, Vec<usize>) {
    let parameter_indices: Vec<usize> = (0..parameters.len()).collect();
    let reference_indices: Vec<usize> = (0..references.len()).collect();
    if is_declaration(mode) {
        return (parameter_indices, reference_indices);
    }
    let mut parameter_keyed: Vec<((String, String), usize)> = parameter_indices
        .into_iter()
        .map(|index| {
            let parameter = &parameters[index];
            (
                key_of(
                    &parameter.definition_ref,
                    parameter.display_value.as_deref().unwrap_or(""),
                    except,
                ),
                index,
            )
        })
        .collect();
    parameter_keyed.sort_by(|left, right| left.0.cmp(&right.0));

    let mut reference_keyed: Vec<((String, String), usize)> = reference_indices
        .into_iter()
        .map(|index| {
            let reference = &references[index];
            let identity = format!(
                "{}{}",
                reference.target_raw_path.as_deref().unwrap_or(""),
                reference.context_paths.join("")
            );
            (key_of(&reference.definition_ref, &identity, except), index)
        })
        .collect();
    reference_keyed.sort_by(|left, right| left.0.cmp(&right.0));

    (
        parameter_keyed
            .into_iter()
            .map(|(_, index)| index)
            .collect(),
        reference_keyed
            .into_iter()
            .map(|(_, index)| index)
            .collect(),
    )
}
