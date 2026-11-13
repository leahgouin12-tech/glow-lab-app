/** Exercise reference (Part 17) — patterns and cues, not medical programming. */
export interface ExerciseRef {
  name: string;
  pattern: 'hinge' | 'squat' | 'push' | 'pull' | 'carry' | 'brace' | 'rotate' | 'gait';
  focus: string[];
  equipment: string[];
  difficulty: number;
  cue: string;
  caution: string;
}

export const EXERCISE_REFERENCE: ExerciseRef[] = [
  { name: 'Goblet squat', pattern: 'squat', focus: ['quads', 'glutes', 'trunk'], equipment: ['dumbbell', 'kettlebell', 'none'], difficulty: 2, cue: 'Ribs stacked over pelvis, knees track over toes, depth you control.', caution: 'Stop if there is sharp joint pain — a pinch is not a goal.' },
  { name: 'Hip hinge (Romanian deadlift)', pattern: 'hinge', focus: ['glutes', 'hamstrings', 'back'], equipment: ['barbell', 'dumbbells', 'bands'], difficulty: 3, cue: 'Hips back, spine neutral, load close to the body.', caution: 'Rounding under load is a signal to reduce weight, not push through.' },
  { name: 'Glute bridge', pattern: 'brace', focus: ['glutes', 'hamstrings'], equipment: ['none', 'band'], difficulty: 1, cue: 'Posterior tilt first, then lift; finish with the hip, not the lower back.', caution: '' },
  { name: 'Split squat', pattern: 'squat', focus: ['quads', 'glutes', 'balance'], equipment: ['none', 'dumbbells'], difficulty: 3, cue: 'Front knee over mid-foot, torso upright, controlled descent.', caution: 'Hold a support while learning balance.' },
  { name: 'Push-up (incline to full)', pattern: 'push', focus: ['chest', 'shoulders', 'trunk'], equipment: ['none'], difficulty: 2, cue: 'One line from ear to ankle; the incline is the regression, not a lesser version.', caution: '' },
  { name: 'Row (bent-over or seated)', pattern: 'pull', focus: ['back', 'biceps'], equipment: ['dumbbells', 'band', 'barbell'], difficulty: 2, cue: 'Elbow to hip, shoulder stays off the ear, no yanking with the low back.', caution: '' },
  { name: 'Lat pull-down / band pull', pattern: 'pull', focus: ['lats', 'shoulders'], equipment: ['cable', 'band'], difficulty: 1, cue: 'Chest tall, pull to the ribcage, control the return.', caution: '' },
  { name: 'Pallof press', pattern: 'brace', focus: ['trunk', 'obliques'], equipment: ['band', 'cable'], difficulty: 2, cue: 'Resist the rotation rather than fighting it with the shoulders.', caution: '' },
  { name: 'Farmer carry', pattern: 'carry', focus: ['grip', 'trunk', 'posture'], equipment: ['dumbbells', 'kettlebells'], difficulty: 1, cue: 'Tall, quiet steps, shoulders relaxed down.', caution: 'Reduce load if the shoulder shrugs up or the trunk leans.' },
  { name: 'Dead bug', pattern: 'brace', focus: ['deep core', 'coordination'], equipment: ['none'], difficulty: 1, cue: 'Low back stays long and calm as the limbs move.', caution: '' },
  { name: 'Thoracic extension over foam', pattern: 'rotate', focus: ['mobility', 'mid-back'], equipment: ['foam roller'], difficulty: 1, cue: 'Support the head, exhale to let the ribs drop, do not force an arch.', caution: 'Instruction here is not a claim that this permanently changes structure.' },
  { name: 'Incline walk / stair session', pattern: 'gait', focus: ['cardio', 'glutes'], equipment: ['treadmill', 'stairs', 'outdoors'], difficulty: 1, cue: 'Conversational pace is the point of zone-2 work.', caution: '' },
  { name: 'Hip flexor stretch (half-kneeling)', pattern: 'rotate', focus: ['mobility', 'hips'], equipment: ['none'], difficulty: 1, cue: 'Posterior tilt before the lunge, gentle stretch only.', caution: '' },
  { name: 'Neck-set posture rehearsal', pattern: 'brace', focus: ['posture', 'awareness'], equipment: ['none'], difficulty: 1, cue: 'Long through the crown, chin level, shoulders unclenched — practice, not correction.', caution: 'This is awareness training. It does not remodel bone.' }
];
