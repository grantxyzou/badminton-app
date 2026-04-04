export interface SkillLevel {
  level: number;
  name: string;
}

export interface SkillDimension {
  id: string;
  name: string;
  description: string;
  levels: Record<number, string>;
}

export const SKILL_LEVELS: SkillLevel[] = [
  { level: 1, name: 'Beginner' },
  { level: 2, name: 'Recreational' },
  { level: 3, name: 'Intramural' },
  { level: 4, name: 'Varsity' },
  { level: 5, name: 'Provincial' },
  { level: 6, name: 'National' },
];

export const SKILL_DIMENSIONS: SkillDimension[] = [
  {
    id: 'grip-stroke',
    name: 'Grip & Stroke',
    description: 'Ability to use appropriate grip per shot and to perform strokes that achieve the intended shot, and provide the player with maximum options. Also includes the ability to use deception.',
    levels: {
      1: "Fixed grip, often 'frying pan' or backhand only. May emulate grip from other racquet sports.",
      2: 'Usually self-taught. Grip is fixed in one or two positions and overly firm. Mostly uses elbow, shoulder and body to generate power. Backhand very weak and inconsistent.',
      3: 'Starting to use wrist to generate power, but still relies on elbow and shoulder for power. Can switch grip given enough time. Backhand stronger, but inconsistent and still using hinged wrist/elbow.',
      4: 'Primarily uses wrist rotation for power and precision. Backhand may still be significantly weaker, but can return shots consistently and with reasonable depth and precision. Deception more practiced and used more effectively, but still only for a few shots and somewhat inconsistent.',
      5: 'Uses wrist and fingers to generate power and maximize deception and shot-making options. Advanced-level use of a variety of deception techniques, used consistently.',
      6: 'Has expert coordination, and a variety of shot options at all times. Can apply deception to almost any shot, and does so whenever it creates an advantage.',
    },
  },
  {
    id: 'movement',
    name: 'Movement',
    description: 'Both individual movement technique, speed, efficiency, and stamina, as well as understanding the appropriate positioning and movement for singles, doubles, and mixed doubles.',
    levels: {
      1: "Usually moves too slow or too fast, frequently unable to reach shuttle. Difficulty anticipating opponents' shot trajectory.",
      2: 'Can reach the shuttle most of the time, but movement not efficient. No split step or scissor kick. Frequently forgets proper doubles positioning / rotation.',
      3: "Movement becoming more efficient. Scissor kick used when time permits. Still no consistent split step. Understands doubles rotation and 'returning to base' for singles. Struggles with Mixed positioning.",
      4: 'Simple (1-2 step) movement patterns now practiced and becoming more efficient. Split step is used 25-50% of the time. Starting to understand when to adjust position when opponents\' shots are predictable or limited.',
      5: "Movement is very fast and efficient. Split step is used 80-90% of the time. Positioning optimized to take advantage of any weakness in opponents' shots, and to defend against deception. Can move/rotate effectively in all events, but specializes in 1-2.",
      6: "Refined through years of practice and coaching, specialized for a specific event. Anticipates/reads opponents' shot options at expert level and adjusts position accordingly. Split step used for every shot.",
    },
  },
  {
    id: 'serve-return',
    name: 'Serve & Return',
    description: 'Skill in initiating rallies with quality and consistent serves and returns with the intent of gaining and maintaining an advantage of opponents.',
    levels: {
      1: 'Inconsistent (less than 50%). Unable to control height or angle. Focused on keeping shots in the court.',
      2: 'Serve is becoming more consistent (50-70%). Short serve is high, long/flick serve is short. Serve return predictable based on serve trajectory.',
      3: 'Short serve (60-80%) is tighter when not under pressure, but still predictable. Long serve (70-80%) deeper, harder to attack. Starting to add some variety to serve return, getting occasional winner.',
      4: 'Short and long serve are both 90%+, though many still get attacked regularly. Moves to intercept serve to maximize shot options, and varies return based on opponents\' positioning and weaknesses.',
      5: 'Serve consistency very high (98%+) and is very difficult to attack. Able to add some deception and variety to serve when applicable. Serve return is always aggressive to maintain pressure on opponent(s).',
      6: 'Serve and return regularly incorporate deception, and remains very consistent. Serve return is extremely aggressive in doubles, more patient in singles.',
    },
  },
  {
    id: 'offense',
    name: 'Offense',
    description: "Ability to gain and maintain offense with appropriate use of attack-clears, drops, drives, smashes and variations on these.",
    levels: {
      1: 'Mostly focused on keeping shot in the court. May attack whenever possible, even if not in position.',
      2: 'May have developed power, but not much consistency. Unforced errors are very common. Attacks are flat and only one speed depending on attacking position.',
      3: 'Has distinct clear, smash, and drop now, but always executed with the same power and angle (depending on attacking position). Starting to consistently direct shots to weaker opponent in doubles, or opponent\'s backhand in singles.',
      4: 'When in position, lifts/clears are consistently high and deep, other shots consistently tight to the net. Starting to consciously vary both power and angle of shots to test opponents\' defense and avoid predictability.',
      5: 'Able to consistently maintain offense through deception, speed, positioning, and grip adjustment. Generally few unforced errors unless under high pressure. Varies attack speed and angle to keep opponents off balance.',
      6: 'As with Level 5, but faster and with more variety and deception.',
    },
  },
  {
    id: 'defense',
    name: 'Defense',
    description: 'Ability to defend against offensive shots using clears, lifts, blocks, drives, net-play and variations on these.',
    levels: {
      1: "Unable to consistently read opponent's shots. Unable to defend against shots with pace.",
      2: "Has developed some defense against certain shots. Unexpected attack angles / speeds generate errors.",
      3: 'Becoming able to anticipate attacks and defend against them. Not yet able to predictably convert defense into offense. Still gets caught by unexpected shots, and awkward angles.',
      4: 'Now able to defend against quality attacks and take advantage of weak attacks such as drive/drop return of smash or executing tight net returns. Able to redirect on defense when in position.',
      5: 'Intercepts shuttle as soon as possible to maximize defensive angles. Able to consistently use deception when receiving weak offensive shots.',
      6: 'Usually a series of high-quality attacking shots needed to force a defensive error. Able to defend against any shot when properly positioned.',
    },
  },
  {
    id: 'strategy',
    name: 'Strategy',
    description: "The ability to construct rallies and series of rallies that capitalize on player's (and partner's) own strengths / opponents' weaknesses.",
    levels: {
      1: 'No strategy per se, other than keeping shots in the court.',
      2: "May try to keep the rally going, or may try to attack everything. May be starting to use openings in opponents' defense when obvious.",
      3: 'Tries to pull opponents out of position to create openings, but only using single shots and not able to execute consistently.',
      4: 'Starting to think in terms of shot and movement patterns, stringing 2-3 shots in a row to achieve an advantage. Able to adjust strategy based on opponents, and based on own level of fatigue.',
      5: "Analyses opponents strengths and weaknesses to optimize strategy based on own skills. Advanced understanding of movement and shot patterns, and when to use them.",
      6: 'As with Level 5, but more quickly analyses opponents, and a more extensive set of strategies to choose from. Alters strategy on a point-by-point basis to avoid predictability.',
    },
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Understanding of the sport, including the Laws of Badminton, and competitive-level court and club etiquette.',
    levels: {
      1: 'May or may not understand scoring and lines. Difficulty remembering score. No sense of sport-specific etiquette.',
      2: 'Understands line calls and scoring. May not know service rules, tournament formats, etc. Etiquette depends on background.',
      3: 'Understands the sport rules. Has played at multiple clubs, and understands etiquette, though may not apply it.',
      4: 'Understands the sport rules, etiquette and tournament formats. Can reasonably assess level of play relative to own.',
      5: 'Complete understanding of sport up to the provincial or national level of competition.',
      6: 'Complete understanding of the sport up to the national and international level of competition.',
    },
  },
];
