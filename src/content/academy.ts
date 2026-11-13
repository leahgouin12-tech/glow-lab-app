import type { TutorialRow, BaseRow } from '../db/schema';

/**
 * Glow Academy (spec Part 21) — original written tutorials.
 * Every tutorial is authored for this application. No video links are
 * invented; `mediaId` stays null until the user attaches their own photo, and
 * the Academy page states plainly that these are written guides, not hosted
 * video courses.
 */
export type TutorialSeed = Omit<TutorialRow, keyof BaseRow>;

const step = (order: number, label: string, detail: string, caution = '') => ({
  id: `s${order}`,
  order,
  label,
  detail,
  mediaId: null as string | null,
  caution
});

export const ACADEMY_TUTORIALS: TutorialSeed[] = [
  {
    slug: 'std-photo-setup',
    title: 'Setting up a standardised photo station',
    domain: 'documentation',
    summary:
      'Before anything else: a repeatable way to photograph yourself. Every progress claim in this app depends on this, because lighting and lens distance change apparent face shape more than most products do.',
    difficulty: 1,
    minutes: 45,
    materials: [
      { label: 'Tripod or a stable shelf', productId: null, optional: false },
      { label: 'Tape to mark floor and wall positions', productId: null, optional: false },
      { label: 'A plain wall, ideally north-facing window', productId: null, optional: false },
      { label: 'Timer or remote shutter', productId: null, optional: true }
    ],
    steps: [
      step(1, 'Pick one spot and mark it', 'Tape a mark on the floor where your feet go and a mark on the wall or tripod at eye height. Distance matters most: 1.5–2 m for portraits, 2.5 m for full body.'),
      step(2, 'Choose one light condition', 'Diffused daylight from a window in front of you, or one overhead light plus a bounce. Record which. Never compare a bathroom-fluorescent photo against a golden-hour one.'),
      step(3, 'Set the camera to the same focal length', 'On a phone, use the same lens (1x, not the wide selfie lens) every time. Selfie lenses bulge the centre of the face.', 'Do not mix 0.5x, 1x and 2x in one comparison set.'),
      step(4, 'Neutral expression protocol', 'Relaxed mouth, eyes open, no chin squeeze. Take one neutral, one slight-smile, one profile left, one profile right, one three-quarter.'),
      step(5, 'Write the conditions into the app', 'Attach the photos through a department picker and fill pose, lighting and distance. That metadata is what makes the comparison honest later.'),
      step(6, 'Photograph the same day each cycle', 'Same day of week, same hour band. Skin, sleep and fluid shift day to day; the schedule removes that noise.')
    ],
    pitfalls: [
      'Comparing photos taken months apart under different light and calling it progress.',
      'Changing camera distance — a closer camera enlarges the nose and narrows the face.',
      'Squinting to "look defined", which reads as tension, not structure.',
      'Using the front camera mirrored for some shots and not others, which flips asymmetry.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'reading-a-skincare-label',
    title: 'Reading a skincare label in 3 minutes',
    domain: 'skincare',
    summary:
      'How to tell whether a product is worth owning before it enters your library — ingredient order, what marketing words do not mean, and the two things that actually predict whether it will suit you.',
    difficulty: 1,
    minutes: 25,
    materials: [
      { label: 'The product (or its online INCI list)', productId: null, optional: false },
      { label: 'Your skin profile in Glow Lab', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Read the first five ingredients', 'They are roughly the bulk of the formula. If the "hero active" is 14th, you are buying a moisturiser with a story.'),
      step(2, 'Find the delivery system', 'Water-based serum, lotion, cream, oil, gel. Match it to what your skin needs, not what sounds luxurious.'),
      step(3, 'Identify the actual active', 'One product, one job. A bottle claiming to be an exfoliant, retinoid, brightener and barrier cream is claiming none of them well.'),
      step(4, 'Check the irritant risk for YOU', 'Fragrance and essential oils near the top are a problem only if your skin is reactive. Your saved sensitivities decide this, not a blog.'),
      step(5, 'Check packaging against chemistry', 'Vitamin C and retinoids want opaque, airless or pump formats. A clear jar of a sensitive active is a chemistry problem.', 'A beautiful jar can be the worst container for the active inside it.'),
      step(6, 'Record it in Beauty Market with a status', 'Wishlist / owned / tried / repurchase. Add the reason you bought it — future-you will want it.')
    ],
    pitfalls: [
      'Assuming "clean" or "natural" means effective, or that "clinical" means tested.',
      'Buying on the star ingredient list while ignoring the 12 similar products already at home.',
      'Judging a product after 4 days of use.',
      'Concluding a product caused a purge when the routine changed in three places at once.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'one-active-at-a-time',
    title: 'Introducing one active at a time',
    domain: 'skincare',
    summary:
      'The single highest-value skin habit: a two-week introduction cadence that makes it possible to attribute results instead of guessing.',
    difficulty: 1,
    minutes: 15,
    materials: [
      { label: 'The new active', productId: null, optional: false },
      { label: 'Glow Lab skin journal', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Pause every other change', 'No new exfoliant, no new fragrance, no new mask for the duration.'),
      step(2, 'Patch test where the skin is thin', 'Behind the ear or inner forearm for 48 hours before the face.'),
      step(3, 'Start at low frequency', 'Twice in the first week for a retinoid; every other night for an acid. Consistency beats intensity.'),
      step(4, 'Log each day', 'One line: stinging, flaking, tightness, spots. The journal turns a vague feeling into a trend.'),
      step(5, 'Increase only when tolerating', 'One variable at a time — frequency, then strength. Never both in the same week.'),
      step(6, 'Judge at 8 weeks, not 10 days', 'Retinoid and pigment actives work on the turnover cycle, which is measured in weeks.', 'Early worsening is common; escalating stinging is not.'),
      step(7, 'Write the verdict into the product record', 'Keeps / dropped / revisit. This is how your library starts predicting you.')
    ],
    pitfalls: [
      'Starting three new products "because the routine needed an overhaul".',
      'Adding an active to fix damage the previous active caused.',
      'Stopping at week two because nothing visible had happened.',
      'Continuing through burning, weeping or persistent redness and calling it a purge.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'brow-map-shaping',
    title: 'Mapping and shaping your own brows',
    domain: 'grooming',
    summary:
      'A geometry-first brow method: find your own start, arch and end from your facial landmarks instead of copying a shape that belongs to someone else’s bone.',
    difficulty: 2,
    minutes: 35,
    materials: [
      { label: 'A straight pencil or clean spoolie', productId: null, optional: false },
      { label: 'Tweezers (clean)', productId: null, optional: false },
      { label: 'Small scissors', productId: null, optional: true },
      { label: 'Daylight or a single front light', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Start point', 'Hold the pencil vertically against the side of your nostril. Where it crosses the brow bone is where hair should begin. Nothing inside that line gets touched.'),
      step(2, 'Arch point', 'Angle the pencil from nostril past the outer edge of your iris, eye looking forward. That is your natural arch. It is rarely where fashion places it.', 'The arch is determined by your bone and eye position, not the trend of the year.'),
      step(3, 'End point', 'From nostril to the outer corner of the eye. Past that, the brow should not exist.'),
      step(4, 'Brush all hairs in the direction they grow', 'Up in the front, out along the body, down at the tail. Only now can you see the real shape.'),
      step(5, 'Remove only what is clearly outside the map', 'Under the brow line first, one side at a time, then compare. Stop while it still looks like you.', 'Do not chase a perfect mirror — brows are sisters.'),
      step(6, 'Trim only hairs that hang below the line after brushing', 'Comb up, cut only what crosses the top edge, in tiny amounts.', 'Over-trimming shortens the brow and takes six weeks to fix.'),
      step(7, 'Photograph and log', 'Save a standardised photo set plus a note on how it felt. Rate the result 1–5; the next cycle uses that data.')
    ],
    pitfalls: [
      'Tweezing the top line to "lift" the brow, which usually creates a surprised, drawn look.',
      'Shaping under bathroom downlighting, then discovering the result in daylight.',
      'Working both brows to completion before comparing them.',
      'Plucking every few days instead of letting a growth cycle settle so you can see the actual pattern.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'length-retention-audit',
    title: 'Hair length-retention audit',
    domain: 'hair',
    summary:
      'Why hair seems to "stop growing" — it rarely does. This finds where the length is being lost instead, using the Hair Studio records you already have.',
    difficulty: 2,
    minutes: 30,
    materials: [
      { label: 'Comb', productId: null, optional: false },
      { label: 'Tape measure', productId: null, optional: false },
      { label: 'Same-marked parting for measurement', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Measure the same way every time', 'From the same parting point at the hairline to the tip, hair down and unstretched. Record it, do not eyeball it.'),
      step(2, 'Count shed hairs for one wash', 'Hair in the drain plus on the brush after one wash. A few dozen is normal; a handful nightly is a signal.'),
      step(3, 'Inspect the ends for breakage, not split ends alone', 'White dots, tapered points, uneven lengths along the shaft, all read as mechanical or chemical breakage.'),
      step(4, 'Find the friction sources', 'Sleep surface, ponytail placement and tension, heat tool frequency, towel drying, combing when dry vs damp.', 'The tightest, highest ponytail is usually the answer.'),
      step(5, 'Check the elasticity of a single strand', 'Wet a hair, stretch gently. It should return. If it snaps at low stretch or stretches endlessly and breaks, moisture/protein balance is off.'),
      step(6, 'Change ONE variable for 4 weeks', 'Lower the ponytail, or stop the flat iron, or switch the night wrap. Re-measure after four weeks.'),
      step(7, 'Log length, shed count and the one variable changed', 'The correlation is the whole point of tracking.'),
      step(8, 'Re-measure after four weeks', 'Compare against the baseline, not against the last haircut.')
    ],
    pitfalls: [
      'Cutting more length to remove breakage without removing the cause, so it comes back at the same height.',
      'Measuring stretched hair, then "losing" progress between sessions.',
      'Attributing normal seasonal shedding to a new product.',
      'Adding protein treatments when the issue is tension, or vice versa.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'loc-maintenance-log',
    title: 'Loc maintenance: a retwist and repair log',
    domain: 'hair',
    summary:
      'How to keep a loc record that is actually useful: install date, thickness by section, root growth, retwist cadence, repairs and the photos that show the trajectory.',
    difficulty: 2,
    minutes: 25,
    materials: [
      { label: 'Clip or section marker for consistent counting', productId: null, optional: true },
      { label: 'Ruler', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Establish the baseline', 'Count locs by section (front, sides, crown, back), record the method used to count so the number means the same thing next time.'),
      step(2, 'Record thickness honestly', 'Grade by comparison to something fixed — pencil, chopstick, pinky — rather than a vague adjective.'),
      step(3, 'Photograph the roots with the same parting', 'Same distance, same light. Root length is best seen against a grid or a coin.'),
      step(4, 'Log retwist dates and method', 'Note whether the method is a firm gel, palm-roll, interlocking, or latch hook. Different methods load the root differently.'),
      step(5, 'Track the interval, not the calendar', 'Retwisting too often is where thinning at the root starts. Most issues trace back to over-tightening, not under-styling.', 'If the root is tender after a retwist, that is information, not a normal cost.'),
      step(6, 'Record repairs as their own events', 'Which loc, what failed, what was used. A pattern of the same loc failing means tension or a styling habit.'),
      step(7, 'Measure length at the same loc each cycle', 'Pick one marked loc as a length indicator plus an overall average.'),
      step(8, 'Review at three months', 'Look for thinning roots, uneven growth, or repeated break points.')
    ],
    pitfalls: [
      'Retwisting on a schedule you set to feel productive rather than one the root growth requires.',
      'Counting locs differently each time and concluding hair has "changed".',
      'Ignoring tender, raised bumps at the hairline — that is traction, and it is not always reversible.',
      'Heavy butters on the roots to hide dryness, which builds up and worsens it.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'makeup-chart',
    title: 'Building a face chart for a look',
    domain: 'makeup',
    summary:
      'Turn "that makeup I saw once" into a reproducible look: a chart of placement, product, and the order that made it work.',
    difficulty: 2,
    minutes: 40,
    materials: [
      { label: 'Paper or the Glow Lab makeup look editor', productId: null, optional: false },
      { label: 'Your own products', productId: null, optional: false },
      { label: 'A reference image you may legally keep', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Break the look into zones', 'Base, eyes (lid / crease / liner / lash), brows, cheeks, lips. Write each zone separately, even if the answer is "nothing".'),
      step(2, 'Name the finish, not just the colour', 'Matte, satin, foil, diffused. Finish is why two identical eyeshadows give different results.'),
      step(3, 'Record placement against your own landmarks', 'Where the crease colour actually sits on your eye, not where it sits on the reference eye.', 'This is the step people skip, and the reason recreations "do not work on me".'),
      step(4, 'Assign products you own first', 'Search your collection before adding to the wishlist. Most recreations fail on inventory awareness, not budget.'),
      step(5, 'Write the application order', 'Primer, base, concealer, powder, brows, shadow, liner, mascara, cheeks, lips. Order is a large part of the result.'),
      step(6, 'Wear it once and photograph it', 'Same angle as the reference so the comparison means something.'),
      step(7, 'Annotate the gap', 'What is different: placement, intensity, or your own features. Save the corrected chart.'),
      step(8, 'Rate and schedule', 'Everyday / occasion / once. A look rated 4+ becomes a repeatable option instead of a rumour.')
    ],
    pitfalls: [
      'Recreating a look photographed in studio lighting for a daylight office.',
      'Copying the reference’s placement exactly onto a different eye shape.',
      'Buying five products to build one look and using none of them again.',
      'Charting the look but never wearing it, so the chart never gets corrected.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'capsule-wardrobe',
    title: 'Building a capsule from what you already own',
    domain: 'style',
    summary:
      'A wardrobe audit that starts with your existing closet and your actual week — the fastest route to "I have nothing to wear" disappearing.',
    difficulty: 2,
    minutes: 60,
    materials: [
      { label: 'Your catalogued clothing (or the app catalog)', productId: null, optional: false },
      { label: 'A list of the last 3 weeks of real plans', productId: null, optional: false }
    ],
    steps: [
      step(1, 'List the real contexts', 'Not ideal lives — the actual settings you were in over three weeks, with how many times each happened.'),
      step(2, 'Count outfits per context', 'For each context, how many complete, clean, comfortable outfits exist? Under three is the actual problem.', 'Quantity of outfits matters more than variety of garments.'),
      step(3, 'Find the workhorses', 'Items worn 5+ times. These define your real palette and silhouette comfort zone. Build around them, not against them.'),
      step(4, 'Find the orphans', 'Items never worn in a season. Note why in one word: fit, fabric, occasion, memory, guilt.'),
      step(5, 'Choose a working palette of 5–7 colours', 'Two neutrals, one dark, two supporting, one or two accents. Check against the workhorses, not against a colour-analysis trend.'),
      step(6, 'Identify gaps as categories, not products', '"A dry, mid-weight layer that works over the two most-worn tops" — not "a blazer".'),
      step(7, 'Make 6 new outfits from existing stock', 'Combination is free. Photograph each one so the record is real.'),
      step(8, 'Add cost-per-wear to the wishlist', 'Only after step 6. Price per predicted wear, not per garment.'),
      step(9, 'Set a review date', 'Season change is the natural checkpoint.')
    ],
    pitfalls: [
      'Building a capsule around a lifestyle you want rather than the one you have.',
      'Discarding items because they are "not capsule" when they are the reason you got dressed that day.',
      'Buying a "versatile" piece that duplicates what already exists in a different colour.',
      'Never photographing the outfits, so you keep re-discovering the same ones.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'fit-check-before-buying',
    title: 'The 5-second fit check (and the 30-second one)',
    domain: 'style',
    summary:
      'Where garments fail: shoulder seam, chest pull, waist placement, break, and armhole depth. Learn which of these tailoring fixes and which it cannot.',
    difficulty: 1,
    minutes: 20,
    materials: [
      { label: 'A mirror you can turn sideways in', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Shoulder seam', 'It should end where your shoulder ends. Past it, the garment hangs from your arm; short of it, it pulls inward.'),
      step(2, 'Armhole depth', 'Raise your arms. A high, tight armhole lifts the whole garment; a low one gapes. This is the most expensive alteration and the least obvious.', 'Tailoring rarely fixes armholes. Buy for this first.'),
      step(3, 'Chest and back pull', 'Look sideways for an X of strain or a horizontal ridge. One means tight; the other means the wrong length.'),
      step(4, 'Waist and hip placement', 'Where the garment’s waist sits vs where yours does. This decides whether trousers collapse or sit correctly.'),
      step(5, 'Break and hem', 'Trousers: one clean break or none, deliberately. Sleeves: bone visible, not swallowed.'),
      step(6, 'Movement test', 'Sit, reach, walk, look down. If you cannot do all four, you will not wear it.', 'A garment that only works standing still is a costume.'),
      step(7, 'Decide what tailoring can fix', 'Hem, waist, sleeve length, taking in sides — usually yes. Shoulder, armhole, crotch fit — usually no.')
    ],
    pitfalls: [
      'Buying "for after weight change".',
      'Judging a fit in a fitting-room light and never checking in daylight.',
      'Assuming a tailor can fix a shoulder that is two sizes wrong.',
      'Keeping items that fit one body position only.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'beginning-lift-programme',
    title: 'Starting a strength programme you will still be doing in month three',
    domain: 'fitness',
    summary:
      'A minimum-viable training structure: 2–4 sessions, a push/pull/hinge/squat/carry scaffold, and progression that is written down.',
    difficulty: 2,
    minutes: 45,
    materials: [
      { label: 'Whatever equipment you actually have', productId: null, optional: false },
      { label: 'A notebook or the Glow Lab workout log', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Pick days before picking exercises', 'Two fixed, low-conflict days a week beat a perfect plan on days that do not exist.'),
      step(2, 'Choose one movement per pattern', 'Squat, hinge, push (horizontal + vertical), pull (vertical + horizontal), carry, and one core brace. Six movements, not twenty.'),
      step(3, 'Leave 2–3 reps in reserve on every set', 'You should finish a set able to do a little more with clean form. That is the honest intensity for a beginner.', 'Form failure before reps failure. Always.'),
      step(4, 'Start lighter than you think', 'Two easy first weeks. Soreness is not progress; it is usually a sign you skipped the ramp.'),
      step(5, 'Progress one variable at a time', 'Add reps, then sets, then load. Write every number down — the log is the programme.'),
      step(6, 'Warm up the movement you are about to do', 'Bodyweight version, then progressively loaded. Not a static stretch parade.'),
      step(7, 'Deload when performance drops two sessions running', 'Reduce load for a week. Fatigue, not effort, is the usual cause.'),
      step(8, 'Photograph and measure at week 0 and week 12', 'Same conditions, same pose. Progress photos taken under different light are decoration, not data.')
    ],
    pitfalls: [
      'Changing programmes every two weeks so nothing can be measured.',
      'Training to failure on compound lifts as a beginner.',
      'Skipping carries and pulls, then wondering why shoulders look cramped.',
      'Judging progress by the scale within the first month, when water and muscle changes dominate.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'posture-habit-loop',
    title: 'Posture: an awareness loop, not a correction',
    domain: 'posture',
    summary:
      'Posture improves through frequent repositioning and strength, not through holding one position. This builds the cue-and-reset habit.',
    difficulty: 1,
    minutes: 20,
    materials: [
      { label: 'Three daily anchor events (e.g. kettle boils, meeting ends, walking the dog)', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Choose three anchors', 'Existing events you cannot forget. The cue has to be part of your day, not an extra habit.'),
      step(2, 'Reset, do not freeze', 'At each anchor: exhale, let the ribs fall, lengthen through the crown, then move on. Reset takes four seconds.', 'Hold-a-posture is a myth. Static "good" posture is just another static posture.'),
      step(3, 'Check the ears over shoulders from the side', 'Once a day, from a mirror or a standardised profile photo — not from a feeling.'),
      step(4, 'Add load, not willpower', 'Rows, carries, and neck-flexion work make the neutral position cheaper for your system to hold.'),
      step(5, 'Change the environment where possible', 'Screen height, chair depth, phone held at chest instead of lap. This does more than any exercise.'),
      step(6, 'Log discomfort as well as posture', 'Where and when. Neck and low-back patterns usually trace to duration, not position.'),
      step(7, 'Reassess at 6 weeks with photos', 'Same camera distance and same light.')
    ],
    pitfalls: [
      'Forcing an over-arched "military" posture, which loads the lower back.',
      'Believing posture exercises can change bone shape in an adult. They change position and comfort.',
      'Tracking minutes of "good posture" instead of movement variety.',
      'Ignoring radiating numbness or persistent pain, which is a clinician matter, not a habit matter.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'recreate-a-look',
    title: 'Recreating a look from a reference image',
    domain: 'discovery',
    summary:
      'A method for going from "I want to look like that" to an actual plan, using the visible evidence in the image plus your own inventory — without pretending the app knows brands it cannot see.',
    difficulty: 2,
    minutes: 30,
    materials: [
      { label: 'The saved reference image', productId: null, optional: false },
      { label: 'Your closet, hair and makeup records', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Describe only what is visible', 'Silhouette, colour family, fabric appearance, hem length, fit, layering, shine vs matte. Write uncertain items as uncertain.', 'If you cannot see it, it is not in the description. Brand, price and ingredient claims never come from a photograph.'),
      step(2, 'Split the image into components', 'Top, bottom, outerwear, shoes, bag, jewellery, hair, makeup, nails, fragrance-adjacent mood. Tick only the parts you want.'),
      step(3, 'Name the 3 things that make the look', 'Usually two of them are fit and colour relationship, not items. Write them.'),
      step(4, 'Match against your inventory', 'Search each category for the closest owned item. Most looks are 60–80% ownable.'),
      step(5, 'List real gaps', 'One line each: what category, what property, why your existing items do not cover it.'),
      step(6, 'Find alternatives rather than exact copies', 'Same silhouette in a different fabric, same colour family in a cheaper tier, same proportion via tailoring.'),
      step(7, 'Build the recreation plan', 'Steps in the order you would actually do them, with the tutorials that cover any technique you lack.'),
      step(8, 'Wear it, photograph it, compare', 'Standardised angle. Note what changed vs the reference and what you would adjust.'),
      step(9, 'Score the outcome', 'Look-alike %, comfort, cost, effort. A low score is a usable data point, not a failure.')
    ],
    pitfalls: [
      'Chasing the exact garment instead of the proportion that made the image work.',
      'Ignoring that the reference is lit, posed, edited, and often styled by a professional.',
      'Recreating a look whose context you never occupy.',
      'Buying everything and wearing nothing because two owned items would have carried 70% of it.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'should-i-buy-this',
    title: 'Running a SHOULD I BUY THIS? decision properly',
    domain: 'shopping',
    summary:
      'The decision framework behind the Beauty Market tool — cost-per-wear, real duplication, and the difference between wanting an item and wanting an outcome.',
    difficulty: 1,
    minutes: 15,
    materials: [
      { label: 'The candidate item', productId: null, optional: false },
      { label: 'Your existing library', productId: null, optional: false }
    ],
    steps: [
      step(1, 'State the outcome, not the item', '"I want to look put-together at evening events" is a goal. "That bag" is one possible route to it.'),
      step(2, 'Duplicate check', 'How many owned items already cover this role? Three is the usual answer, and it is the honest one.'),
      step(3, 'Predict wears/uses per month, realistically', 'Use last season’s actual behaviour, not your intentions.'),
      step(4, 'Compute cost per wear', 'Price ÷ predicted uses. Compare that against your own average across the library, not against a stranger’s opinion.'),
      step(5, 'Check what it pairs with', 'Name 3 outfits or 3 routines it actually fits into. Fewer than 3 is a warning, not a detail.'),
      step(6, 'Check the constraint', 'Budget, storage, climate, care requirements, travel. An item that fails a hard constraint is not a bargain.'),
      step(7, 'Wait-list anything above your instant threshold', '7 days for ordinary, 30 for large. Most items do not survive the wait, and that is information.'),
      step(8, 'Record the decision either way', 'Including "no", because your future purchasing patterns are worth knowing.'),
      step(9, 'Review at 3 months', 'Used / unused. Unused purchases update your predicted-wear estimate, which is the whole engine.')
    ],
    pitfalls: [
      'Cost-per-wear math that assumes you will wear something as often as your favourite item.',
      'Treating a discount as a reason rather than a smaller price for the same question.',
      'Buying the "aspirational" version of yourself and never reaching the context.',
      'Never recording the no-decisions, so the pattern stays invisible.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'fragrance-wardrobe',
    title: 'Building a small fragrance wardrobe',
    domain: 'fragrance',
    summary:
      'How to test, choose and wear fewer fragrances better — including the skin-test protocol and the four slots that cover most of life.',
    difficulty: 1,
    minutes: 40,
    materials: [
      { label: 'Blotter strips or clean paper', productId: null, optional: false },
      { label: 'A notebook for the 4/24 hour marks', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Define four slots before testing', 'Everyday, work/formal, evening, and weather-specific (warm or cold). Most people need four, not fourteen.'),
      step(2, 'First pass on paper', 'Three max per sitting, one hour apart. Olfactory fatigue is real and it makes every later test useless.', 'Never test more than three at once.'),
      step(3, 'Skin test the shortlist', 'One spray on the forearm, left alone. Read the drydown at 4 and 24 hours.'),
      step(4, 'Judge performance on your skin, not the counter’s', 'Longevity and projection are skin-chemistry-dependent and store data is not yours.'),
      step(5, 'Check sillage against your contexts', 'An office scent should be discovered at 30 cm, not 3 m.'),
      step(6, 'Dose properly', '2–4 sprays on skin, applied to pulse points after moisturiser. More is not longer, it is louder and shorter-lived in memory.'),
      step(7, 'Store it correctly', 'Cool, dark, upright. Heat and light degrade the top notes you are paying for.'),
      step(8, 'Log the slot, the reaction and the occasion', 'Others’ feedback is data; your own comfort is the deciding factor.')
    ],
    pitfalls: [
      'Buying after one sniff of the top notes, which are the least representative part of the fragrance.',
      'Nose-blindness leading to over-spraying.',
      'Purchasing a fifth scent that occupies the same slot as three you already own.',
      'Choosing a scent for a compliment you will rarely receive in that context.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'designing-an-experiment',
    title: 'Designing an appearance experiment that can actually answer the question',
    domain: 'experiments',
    summary:
      'The difference between trying things and learning things: one variable, a defined period, a standardised photo, and a pre-written success rule.',
    difficulty: 2,
    minutes: 30,
    materials: [
      { label: 'Your standardised photo setup', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Write the question as something a photo or a rating can answer', '"Does a longer, lower bun make my jaw read narrower?" — testable. "Will I look better?" — not.'),
      step(2, 'Choose one variable', 'Everything else — light, angle, camera distance, clothing, expression — is fixed.', 'Two variables means the experiment teaches you nothing.'),
      step(3, 'Write the success rule first', 'Decide in advance what result you will count as yes, no, or inconclusive. This is the step that prevents you from rationalising the answer you hoped for.'),
      step(4, 'Baseline photograph', 'Same conditions, before the change.'),
      step(5, 'Run the period', 'Enough time to reach steady state: 2 weeks for styling, 8 for skin actives, 12 for training.'),
      step(6, 'Log observations during, not only after', 'Daily one-line entries plus any side effects.'),
      step(7, 'End photograph under the identical protocol', 'Same mark on the floor, same hour band, same lens.'),
      step(8, 'Compare side by side and apply the rule', 'Use the comparison tool. Then record the verdict, and the cost/effort you actually paid.'),
      step(9, 'Decide: keep, drop, or retest', 'A retest is not failure; it usually means the variable was not isolated.')
    ],
    pitfalls: [
      'Running a skin experiment during a period of bad sleep and attributing it to the serum.',
      'Judging from a mirror at 20 cm rather than a photo at 2 m.',
      'Changing the success rule after seeing the result.',
      'Repeating a single anecdote as a personal truth without a second run.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  },
  {
    slug: 'professional-consult-prep',
    title: 'Preparing for a professional consultation',
    domain: 'services',
    summary:
      'How to walk into a dermatologist, stylist, dentist or surgeon’s room with a record that gets you a better answer in less time.',
    difficulty: 1,
    minutes: 25,
    materials: [
      { label: 'Your Glow Lab export or profile summary', productId: null, optional: false },
      { label: 'Standardised photos', productId: null, optional: false }
    ],
    steps: [
      step(1, 'Write the concern in your own words, then the goal', '"I want less visible congestion along the jaw" — outcome-focused, not product-focused.'),
      step(2, 'List everything currently used, with frequency', 'Products, actives, supplements, medications, treatments and their dates. Include things you stopped recently and why.'),
      step(3, 'Bring the timeline, not the theory', 'Photos with dates and the record of what changed when. Let the clinician interpret the cause.'),
      step(4, 'Note sensitivities and past reactions', 'What stung, what broke you out, what a professional already tried.'),
      step(5, 'Prepare your questions in order of importance', 'What is actually going on? What has the best evidence? What will this cost, including downtime? What happens if we do nothing?'),
      step(6, 'Ask about the do-nothing option explicitly', 'A good clinician answers this. A reluctant one is information.'),
      step(7, 'Ask what you should NOT do', 'Most people have an unsafe habit already in progress.', 'Bring the app’s flagged-practices list if it is something you have considered. Saying it out early is better than a surprise restriction later.'),
      step(8, 'Record the answer, the evidence and the follow-up date', 'Into the consultation planner, so the second appointment does not start from memory.'),
      step(9, 'Get a second opinion before anything irreversible', 'Permanent procedures deserve two consultations minimum. This is normal and not an insult.')
    ],
    pitfalls: [
      'Self-medicating for months and then presenting a face the clinician cannot read.',
      'Describing products vaguely ("something with acids") instead of the actual list.',
      'Asking for a specific procedure instead of describing the outcome you want.',
      'Accepting a plan you do not understand because the appointment was expensive.'
    ],
    relatedTechniqueIds: [],
    relatedProductIds: [],
    relatedGoalIds: [],
    favorite: false,
    completedOn: null,
    attempts: 0
  }
];

export const ACADEMY_DOMAINS = [
  'documentation',
  'skincare',
  'grooming',
  'hair',
  'makeup',
  'style',
  'fitness',
  'posture',
  'discovery',
  'shopping',
  'fragrance',
  'experiments',
  'services'
] as const;
