export type CaptureQualityIssue =
  | 'low_quality'
  | 'subject_clipped'
  | 'subject_too_far'
  | 'too_dark';

export type CaptureQualityMetrics = {
  aestheticsScore?: number;
  isUtility?: boolean;
  meanLuma?: number;
  subjectArea?: number;
  subjectCentered?: boolean;
  subjectClipped?: boolean;
  subjectConfidence?: number;
};

export type CaptureQualityAssessment = CaptureQualityMetrics & {
  issue?: CaptureQualityIssue;
  shouldRetake: boolean;
};

/**
 * L'esthétique va de -1 à 1 ; -0,80 ne coupe que l'extrême afin qu'une photo
 * documentaire, moins spectaculaire, ne soit jamais punie pour son style.
 * Les conseils de cadrage exigent une salience suffisamment confiante : une
 * branche ou un rocher ne doit jamais faire reprendre une rencontre rare.
 */
export function withCaptureQualityDecision(
  metrics: CaptureQualityMetrics,
): CaptureQualityAssessment {
  const issue: CaptureQualityIssue | undefined =
    metrics.meanLuma !== undefined && metrics.meanLuma <= 24
        ? 'too_dark'
        : metrics.subjectConfidence !== undefined && metrics.subjectConfidence >= 0.5 && metrics.subjectClipped
          ? 'subject_clipped'
          : metrics.subjectConfidence !== undefined &&
              metrics.subjectConfidence >= 0.5 &&
              metrics.subjectArea !== undefined &&
              metrics.subjectArea <= 0.04
            ? 'subject_too_far'
            : metrics.aestheticsScore !== undefined && metrics.aestheticsScore <= -0.8
              ? 'low_quality'
              : undefined;

  return { ...metrics, issue, shouldRetake: issue !== undefined };
}
