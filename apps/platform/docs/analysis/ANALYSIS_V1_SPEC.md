# FormPilot Analysis v1 Specification

## 1. Version and authority

- Version: `analysis-v1`.
- This document is the source of truth for the analysis engine, Report UI, History UI, tests, and future coding agents.
- `src/features/analysis/issueTaxonomy.ts` is the executable authority for the reportable issue whitelist; exercise threshold values remain authoritative in each exercise's config.

## 2. Scope

Analysis v1 is deterministic, pure, and computed at read time. It is not persisted and must not mutate session/history input. It covers five scored exercises (`overhead_raise`, `lateral_raise`, `step_jack`, `squat`, `knee_raise`) plus the unscored guidance exercise `shoulder_rotation`.

All scored facts are recomputed from repetition records. Analysis v1 does not consume stored aggregate fields such as `courseOverallScore`, exercise `overallScore`, `metricAverages`, `topErrors`, `topRecurringErrors`, or `totalFeedbackCount` as analysis evidence.

Shoulder rotation is guidance-only: its completion and data quality may be reported, but its corrections never become scored issues or capability contributors.

## 3. Session eligibility

Rules support is one of:

- `SUPPORTED`: the stored rules version exactly matches an entry in `ANALYSIS_CONFIG_V1.supportedRulesVersions`.
- `LEGACY_UNVERSIONED`: no rules version is stored. Analysis may use evidence that actually exists, but the session is not history-comparable and missing modern fields are never inferred.
- `UNSUPPORTED`: a stored rules version is present but not supported. Scores may be shown, but issue analysis is disabled.

Mode is one of `normal`, `fast`, or `unknown`. A missing mode is `unknown`, never implicitly `normal`. Only live, normal, supported, course-flow, finalized sessions are eligible as comparable current sessions. A course-flow session must match the configured course id, version, and exact exercise order. A finalized session has `status=completed`, a finite `endedAt`, and `courseStatus` of `completed` or `incomplete`.

## 4. Comparison

Comparison levels:

- `FULL`: current and selected previous sessions both have reliable full-course analysis scores. All five scored exercises are the common scope; overall delta is allowed.
- `PARTIAL`: at least two scored exercises are completed and scoreable on both sides. Exercise and capability comparisons use only that common scope; overall delta is forbidden.
- `NONE`: no eligible comparison can be made.

The current-session rejection order is normative and stops at the first match:

```text
CURRENT_NOT_LIVE
CURRENT_RULES_UNVERSIONED
CURRENT_MODE_UNKNOWN
CURRENT_FAST_MODE
CURRENT_RULES_UNSUPPORTED
CURRENT_NOT_COURSE_FLOW
CURRENT_NOT_FINALIZED
```

Eligible history is strictly older than the current session, sorted newest first with a deterministic id tie-break. Candidate exclusion records all applicable reasons. After current-session gates, absence of an eligible candidate yields `NO_ELIGIBLE_PREVIOUS`; fewer than two common scoreable exercises yields `INSUFFICIENT_COMMON_EXERCISES`.

### R2 accepted conflict resolutions

The following three R2 resolutions are intentional and frozen:

1. Knee-raise alternation uses repetitions (`次`), while left/right height gap uses non-overlapping pairs (`组`); their incidence and targets are never merged.
2. A `PARTIAL` comparison's common scope contains only exercises completed with a score on both sides, not every exercise record present in both sessions.
3. A real legacy record missing both rules version and mode reports `CURRENT_RULES_UNVERSIONED`; missing rules takes precedence over `CURRENT_MODE_UNKNOWN`.

## 5. Repetition validity

Every repetition is classified as:

- `VALID`: identity, timestamps, duration, score, required raw fields, side/boolean fields, and non-empty valid metric scores are present; no pose-quality invalidation is present.
- `PARTIAL`: the repetition otherwise passes, but an overhead-raise `topElbowL` or `topElbowR` value is missing/non-finite.
- `INVALID`: any required structural, raw, timing, metric, score, or pose-quality condition fails.

`VALID` and `PARTIAL` repetitions may contribute where their required evidence exists. `INVALID` repetitions are excluded from scores, issue denominators, capabilities, and trends; they are never treated as zero.

## 6. Report issue taxonomy

`REPORT_ISSUE_TAXONOMY` is the only reportable issue whitelist. It contains exactly 32 expanded definitions. Each definition has this schema:

```text
canonicalId, exerciseId, runtimeCodes[], bodyRegion, dimension,
reportLabel, cue, reportable=true, trendable=true,
evidenceSource(rep|derived), groupId, side, themeId,
technicalPriorityWeight(1|2|3), sideModel
```

Threshold values are read from the corresponding exercise config; they are not duplicated in analysis config. The frozen rules are:

| # | Canonical id | Dimension | Evidence rule |
|---:|---|---|---|
| 1 | `overhead_raise.arm_height` | AMPLITUDE | minimum of left/right peak shoulder angle is below the overhead top threshold |
| 2 | `overhead_raise.elbow_extension.left` | FORM | left TOP-phase elbow angle is below the correction threshold |
| 3 | `overhead_raise.elbow_extension.right` | FORM | right TOP-phase elbow angle is below the correction threshold |
| 4 | `overhead_raise.arm_symmetry` | COORDINATION | maximum arm-height difference exceeds threshold |
| 5 | `overhead_raise.torso_lean` | STABILITY | maximum torso lean exceeds threshold |
| 6 | `overhead_raise.too_fast` | TEMPO | repetition duration is below the configured minimum |
| 7 | `lateral_raise.arm_height.left` | AMPLITUDE | left peak shoulder angle is below top threshold |
| 8 | `lateral_raise.arm_height.right` | AMPLITUDE | right peak shoulder angle is below top threshold |
| 9 | `lateral_raise.elbow_extension.left` | FORM | left minimum elbow angle is below threshold |
| 10 | `lateral_raise.elbow_extension.right` | FORM | right minimum elbow angle is below threshold |
| 11 | `lateral_raise.arm_symmetry` | COORDINATION | maximum arm-height difference exceeds threshold |
| 12 | `lateral_raise.torso_lean` | STABILITY | maximum torso lean exceeds threshold |
| 13 | `lateral_raise.too_fast` | TEMPO | repetition duration is below the configured minimum |
| 14 | `step_jack.step_width` | AMPLITUDE | peak open ratio is below threshold; retains left/right rep breakdown |
| 15 | `step_jack.arm_height` | AMPLITUDE | peak mean shoulder angle is below threshold |
| 16 | `step_jack.limb_sync` | COORDINATION | derived sync gap exceeds threshold, only after both arm and step gates were reached |
| 17 | `step_jack.arm_symmetry` | COORDINATION | maximum arm-angle difference exceeds threshold |
| 18 | `step_jack.alternation` | FORM | wrong-side sequence is true; the first recorded rep is not evaluable |
| 19 | `step_jack.body_sway` | STABILITY | maximum torso lean exceeds threshold |
| 20 | `step_jack.too_fast` | TEMPO | repetition duration is below the configured minimum |
| 21 | `squat.depth` | AMPLITUDE | maximum hip drop is below valid-depth threshold |
| 22 | `squat.knee_alignment` | FORM | minimum knee-spread ratio is below threshold |
| 23 | `squat.lateral_balance` | COORDINATION | maximum knee-height difference exceeds threshold |
| 24 | `squat.torso_lean` | STABILITY | maximum torso lean exceeds threshold |
| 25 | `squat.too_fast` | TEMPO | repetition duration is below the configured minimum |
| 26 | `knee_raise.knee_height.left` | AMPLITUDE | left-side peak knee height is below user target |
| 27 | `knee_raise.knee_height.right` | AMPLITUDE | right-side peak knee height is below user target |
| 28 | `knee_raise.height_gap` | COORDINATION | derived height gap of a non-overlapping adjacent left/right pair exceeds threshold |
| 29 | `knee_raise.body_sway` | STABILITY | hip shift or torso lean exceeds its threshold |
| 30 | `knee_raise.alternation` | FORM | wrong-side sequence is true; the first recorded rep is not evaluable |
| 31 | `knee_raise.return_to_center` | FORM | incomplete-return flag is true |
| 32 | `knee_raise.too_fast` | TEMPO | repetition duration is below the configured minimum |

Pose-quality codes, incomplete-attempt pseudo-events, shoulder-rotation codes, and other entries in `NON_REPORTABLE_ISSUES` never enter report incidence.

## 7. Issue evidence and significance

Evidence is `rep` or `derived`. Incidence is always `affected / evaluable` for that exact definition and unit. Missing evidence is recorded separately and never added to either numerator or denominator. Bilateral members retain separate ratios; theme members retain their own ratios.

An issue is `SIGNIFICANT` only when all conditions hold:

```text
evaluable >= 4
affected >= 2
affected / evaluable >= 1/3
```

Cross multiplication is used for rational comparisons. If `evaluable < 4`, significance is `INSUFFICIENT_EVIDENCE`; otherwise a failed significance condition is `NOT_SIGNIFICANT`.

Overhead elbow report evidence is TOP-phase `topElbowL/R` only. `minElbow`, runtime errors, reminders, and old metric averages must never fill missing TOP evidence.

## 8. Issue trends

Both sessions need at least four evaluable units. Otherwise the result is `INSUFFICIENT_DATA` when either side has affected evidence, or `null` when neither does. The first matching rule wins:

1. `RESOLVED`: previous significant and current affected is zero.
2. `IMPROVED`: previous significant, current affected is positive, affected count drops by at least 2, and rate drops by at least 1/4.
3. `NEW`: current significant and previous affected is zero.
4. `WORSENED`: current significant, previous affected is positive, affected count rises by at least 2, and rate rises by at least 1/4.
5. `PERSISTENT`: current significant and previous affected is positive.
6. Otherwise `null`.

The public trend vocabulary is `NEW`, `RESOLVED`, `IMPROVED`, `PERSISTENT`, `WORSENED`, and `INSUFFICIENT_DATA` (plus `null` when no trend claim is warranted).

## 9. Score deadbands

- Exercise score: 5 points.
- Overall score: 3 points.
- Capability score: 5 points.

A delta at the positive boundary is `IMPROVED`; a delta at the negative boundary is `DECLINED`; values strictly between the boundaries are `STABLE`.

## 10. Capability v2

The five dimensions and UI labels are:

- `AMPLITUDE` — 幅度
- `STABILITY` — 稳定
- `COORDINATION` — 协调
- `TEMPO` — 节奏
- `FORM` — 动作规范

Continuous capability items (`AMPLITUDE`, `STABILITY`, `COORDINATION`, `TEMPO`) require at least 3 valid units per exercise contributor. `FORM` uses only the frozen `FORM_CHECKS` issue evidence and requires at least 4 evaluable units per check by directly reusing `ANALYSIS_CONFIG_V1.issue.minEvaluableReps`. Three evaluable FORM units produce `value=null` with an explainable unavailable reason; four can be calculated.

An exercise contributes only if completed. A session dimension needs at least 3 usable exercise contributors. Radar availability requires all five dimensions.

## 11. Capability comparison

Capability comparison uses common contributor scope. For each dimension, both current and previous are re-aggregated over the same common exercise ids, with at least 3 common contributors. The comparison payload is authoritative:

```text
dimension.comparison.current
dimension.comparison.previous
dimension.comparison.delta
dimension.comparison.trend
```

`dimension.value` is the current session over all current contributors and must never be compared against `dimension.comparison.previous`.

## 12. Priority

Only significant issues are rankable. Per member:

```text
technicalPriorityWeight × incidence × historyFactor × withinSessionFactor
```

History factors are `NEW=1`, `PERSISTENT=1.25`, `WORSENED=1.5`, `IMPROVED=0.75`, otherwise `1`. Within-session improvement multiplies by `0.8`. Bilateral sides merge only after significance is assessed separately. A theme merges only when significant members occur in at least two different exercises. Selection is deterministic, capped at 3 total and 2 per exercise.

## 13. Strengths

Strengths are deterministic and capped at 2, with at most 1 exercise-specific item per exercise. Candidate order is historical resolved issue, historical score improvement, exercise strength, capability strength, then issue-free theme strength.

- Exercise strength: completed and scoreable, at least 4 analyzed reps, average score at least 85, minimum rep score at least 75, and no significant issue.
- Historical exercise score strength: improvement of at least 5 points.
- Capability strength: value at least 85, at least 3 contributors, every contributor at least 75, and no significant issue in that dimension.
- Issue-free theme strength: at least 3 qualifying exercises, at least 4 evaluable units per exercise, and zero affected units.

## 14. NextFocus

Priority issues produce at most two focus items. Targets use the next course plan's exact unit count: repetitions, per-side repetitions, alternation transitions, or non-overlapping pairs as appropriate.

For current incidence `a/n` and planned denominator `N`, retain the exact maximum affected count for an `IMPROVED`/`RESOLVED` trend:

```text
improvementMax = max(0, min(
  a - 2,
  floor(N × (4a - n) / (4n))
))
```

Also derive the largest affected count that is no longer significant. For the v1 threshold and `N >= 4`:

```text
nonSignificantMax = max(1, ceil(N / 3) - 1)
```

The final target deliberately chooses the easier compliant outcome:

```text
allowedAffected = max(improvementMax, nonSignificantMax)
compliantAtLeast = N - allowedAffected
```

This is deterministic, evidence-backed, measurable, and never invents an arbitrary percentage. Frozen examples:

- Current `2/6` → next target `5/6` compliant.
- Current `2/5` → next target `4/5` compliant.
- Current `4/12` → next target `9/12` compliant.
- Current `4/6` → next target remains `4/6` compliant.

If no priority exists, at most one weak-capability focus may be produced. Tempo fallback targets at least two thirds of planned repetitions inside the exercise's configured duration band.

## 15. Summary

Summary is deterministic, evidence-referenced, and limited to 2–4 sentences in this slot order:

1. `OVERALL`
2. optional `IMPROVEMENT`
3. one of `PRIORITY`, `LIMITED_DATA`, or `NO_PRIORITY`
4. optional `WITHIN_SESSION`, otherwise optional `STRENGTH`

A priority sentence is never swallowed by an overall trend. A partial comparison never claims an overall change. Insufficient elbow evidence must use limited-data language (for example, “手肘伸展仅有 3 次可判断，当前证据不足”) and must not be summarized as “没有需要优先纠正的问题”.

## 16. Data quality and unavailable values

Unknown or insufficient values are represented as `null`/unavailable, never numeric zero. Every unavailable capability or comparison value carries a formal reason such as `EXERCISE_NOT_COMPLETED`, `INSUFFICIENT_EVALUABLE_REPS`, `EVIDENCE_MISSING`, `RULES_UNSUPPORTED`, `INSUFFICIENT_CONTRIBUTORS`, `NO_COMPARISON`, or `COMMON_SCOPE_TOO_SMALL`.

Pose prompts, pose-invalid repetitions, missing TOP-elbow evidence, limited exercises, guidance status, session flags, and comparison limitations remain separate data-quality facts. Prompt counts describe reminders, not issue incidence.

For a completed overhead exercise with 3 evaluable TOP-elbow repetitions and 3 missing, both elbow issues are `INSUFFICIENT_EVIDENCE`; FORM is `null` with 3 evaluable reps and `INSUFFICIENT_EVALUABLE_REPS`; takeaway and summary explicitly state the evidence limitation.

## 17. Known limitations

- Lateral-raise `minElbow` may still be polluted by the full repetition trajectory.
- Overhead runtime scoring still uses `minElbow`, while report elbow issues use TOP-phase `topElbow`.
- No real-human calibration dataset is available.
- Packaged reviewer origin/history behavior remains an environment limitation.
- Shoulder-rotation quality is not persisted.
- Runtime reminder count cannot be used as issue count.

## 18. Mandatory constraints for Phase 8F-2 UI

ReportPage must not use old stored aggregates as analysis-v1 display data. In particular, it must not directly display stored `courseOverallScore`, stored exercise `overallScore`, or old elbow `metricAverages` as report elbow evidence.

Capability comparisons must render `dimension.comparison.current`, `dimension.comparison.previous`, and `dimension.comparison.delta`. They must not render `dimension.value` versus `dimension.comparison.previous`.

Overall labels are scope-dependent:

- `FULL_COURSE`: show `综合评分` only when analysis v1 provides a reliable full-course score.
- `COMPLETED_EXERCISES`: show `已完成动作平均分`; never label it `综合评分`.
- `UNAVAILABLE`: show `暂不给出综合评分`; never display zero.

These constraints apply to ReportPage and History consumers even if legacy aggregate fields remain in the persisted session schema.
