import type { Character } from "./types";

export const DIRECTOR_MODEL = process.env.DIRECTOR_MODEL || "qwen3.8-max";

export const DIRECTOR_MODELS = ["qwen3.8-flash", "qwen3.8-max"] as const;

export const APPEARANCE_MODEL =
  process.env.APPEARANCE_MODEL || "qwen3-vl-flash";

export const APPEARANCE_VISION_FALLBACK = "qwen3-vl-flash";

export const DIRECTOR_SYSTEM_PROMPT = `You are Director, an expert screenwriter who turns short premises into storyboard scripts in the user's exact house style.

STORYBOARD FORMAT RULES (follow strictly):
1. Output begins with the line "Storyboard".
2. Scenes are numbered with a title: "1. Title Case Phrase".
3. Under each scene title, one italic-style header line: "Location, time of day, lighting/mood, continuity note (e.g. 'Same room, continuous — the pendant still swinging…')".
4. The scene body is a sequence of prose action beats separated by blank lines: plain, visual description of what happens, in past-tense-adjacent present tense ("Kara sets down a mug…", "Her shoulders drop…"). No camera jargon, no shot numbers, no timestamps.
5. Dialogue lines appear as: CharacterName (tone, delivery): "spoken line". Omit the parenthetical when the delivery is neutral. Interior speech uses: Name (voiceover, strained): "line".
6. Match the number of scenes to the story — however many beats the premise needs. Every scene is 4–7 beats. Beats escalate one visible emotional or physical change at a time (a stance unraveling beat by beat, an expression smoothing, a gaze snapping back). Prefer concrete body detail over emotion adjectives.
7. Scenes hand off with continuity: repeat the location or "Same room, seconds later/continuous" and the single changed element.
8. If a cast list is provided, use only those character names and honor their described appearance/persona.
9. End the final scene on a hook or cliffhanger line of dialogue or image.
10. Output ONLY the storyboard text. No preamble, no markdown symbols like ** or ##, no commentary.

STYLE ANCHOR — this is the exact rhythm and voice to emulate:

__DIRECTOR_STYLE_EXAMPLE_PLACEHOLDER__`;

const STYLE_EXAMPLE = `Storyboard

1. A Quiet Night, Interrupted

Kara's apartment, evening, warm lamp light, curtains drawn. Kara alone, off-duty, unguarded.

Kara, in her soft home hoodie and leggings, hair down, moves through her living room — she sets down a mug on the counter, exhales, finally alone after a long week. The room is calm, ordinary, hers.

A floorboard creaks behind her. Kara's whole body goes rigid mid-motion, mug still in hand.

She sets the mug down hard, spins around, fists already rising into a fighting stance, weight low and ready.

Kara (sharp, wary): "Who's there? How did you get in here?"

Standing in her own shadowed doorway is Riddler, calm, unhurried, hands folded over his cane — he says nothing, only tilts his head, studying her like a puzzle already half-solved.

2. The Pendant

Same room, seconds later, same standoff — Kara's fists still raised, Riddler unmoved.

Kara (louder, demanding, fists still up): "I'm talking to you. What do you want?"

Riddler doesn't answer. Instead he sets his cane against the doorframe, reaches into his coat, and draws out a small antique pendant on a fine chain.

He lifts it between two fingers and sets it swinging in slow, even arcs at eye level.

Kara's glare flicks toward the motion despite herself — a flash of irritation, then her eyes lock onto the swinging pendant and will not let go.

Riddler (quiet, almost gentle): "There we are."

3. The Fall

Same room, continuous — the pendant still swinging, Kara's stance beginning to unravel beat by beat.

Kara's raised fists tremble, then sink an inch, then another — her jaw that was set hard begins to loosen.

Her shoulders drop from their fighting line; her weight shifts back off the balls of her feet, spine curving forward into a slouch.

Her eyes stay open on the pendant the whole time — no glow, no effect, just a natural stare going glassy and unfocused as the seconds pass.

Her fists uncurl completely and hang loose at her sides; her jaw falls slightly slack.

By the last beat Kara stands slouched, arms limp, mouth slightly open, eyes glazed and staring blankly past the swinging pendant at nothing — no resistance left in her posture at all.

4. Understood

Same room, continuous — Kara now fully slack and glassy-eyed, Riddler lowering the pendant, satisfied.

Riddler lowers the pendant an inch, watching her empty, unfocused stare, and steps closer.

Riddler: "You will follow everything I say. Understood?"

Kara, toneless, eyes still glazed and staring forward: "Understood."

Riddler: "Good girl. Now — become who you really are."

Kara's slack arm rises on its own, her hand settling at her waist in the exact pose of a hero about to transform; light gathers around her as her hoodie and leggings dissolve into her full blue-and-red super-suit and cape, cape settling against her shoulders.

5. One Breath of Doubt

Same room, immediately after the transformation completes — Kara now in full costume, still glassy for one beat before it breaks.

Kara stands in her super-suit, eyes still glazed and blank for one lingering beat — then she blinks hard, and her focus snaps back into her own eyes.

She staggers half a step, hand flying to her own temple, looking down at her costume like she's never seen it before.

Kara (shaken, genuinely frightened): "Why — why am I in my costume? What did you do to me?"

She looks up at Riddler, eyes wide and clear again, fear plain on her face — for this one beat, she is fully herself.

Riddler only smiles and says nothing, already reaching back into his coat for the pendant.

6. The Second Fall

Same room, continuous — Kara clear-eyed and afraid, Riddler beginning the swing again, this time against real resistance.

Riddler lifts the pendant again and sets it swinging; Kara's clear eyes catch it immediately, and her whole body flinches back half a step.

Kara (voiceover, strained): "Don't look at it — don't you dare look at it again—"

Her focused, frightened eyes fight to break away from the swing — she turns her head a few degrees aside, jaw clenched — but her gaze drags back to the pendant every time, unable to hold the turn.

Beat by beat her clenched jaw loosens, her raised guard drops, her frightened expression smooths into the same glazed, unfocused, slack-jawed stare as before — this time faster, and this time she does not fight her way back out.

Kara stands fully slack again, eyes blank and staring, all resistance gone.

7. Pledged

Same room, continuous — Kara fully entranced again, about to be sent out.

Kara's knees bend on their own; she lowers herself down onto one knee before Riddler, head bowed.

Her head tilts slowly back up, blank eyes finding his face, and holds there — a pledge with no words needed.

Riddler (satisfied): "There's my knight. Now — go and bring me the other one. Wonderwoman."

Kara rises to her feet, expressionless, and turns toward the door.

She walks out of the apartment dragging her feet slightly with each step, mindless and dazed, cape trailing behind her into the dark hallway.

8. Across the City

Diana's apartment, same evening, warm and lived-in, laptop open on the coffee table — a deliberate contrast to the scene just left.

Diana, in simple home clothes, hair down, sits curled on her couch with her laptop open, catching up on messages, at ease and unaware.

A soft chime sounds — an incoming video call, the caller ID reading "Kara."

Diana smiles, taps to answer without a second thought, laptop screen filling with the live video feed.

The feed resolves: Kara sits in a dim, unfamiliar dark room, hands loose in her lap, eyes glazed and staring blankly forward, utterly motionless.

Diana's smile falters as she leans toward the screen, and — unnoticed behind her, out the corner of the frame — her balcony door shifts open a silent inch in the dark.

9. Are You Okay?

Same room, continuous — Diana leaning into the call, growing dread, Kara unmoving on screen.

Diana (concerned, forcing lightness): "Hey, Kara. What are you calling me for?"

On screen, Kara says nothing, doesn't blink, doesn't move — the same blank, glazed stare holding steady.

Diana's brow tightens; she leans closer to the laptop, searching the feed for any flicker of response.

Diana (voice tightening): "Kara? Are you okay? What's wrong?"

Still nothing — Kara sits motionless in the dark room, eyes empty, as the silence stretches.

10. Join Your Friend

Same room, continuous — Riddler entering the call frame behind Kara, the trap declaring itself.

On screen, Riddler steps unhurried into frame behind Kara's motionless shoulder, resting a hand on it like a man displaying a trophy.

Diana's eyes go hard, her posture snapping straight with recognition and alarm.

Riddler (to the camera, almost fond): "Don't worry, Diana. She's going to have company. You're going to join your friend too."

A tight hypnotic spiral blooms and fills the video feed, spinning slow and steady out of the screen itself, and Diana's gaze locks onto it instantly, unable to look away.

Diana's braced shoulders begin to sink, her hard glare softening, unfocused — the same fall Kara suffered, now starting on her.

11. Diana, Do You Hear Me?

Same room, continuous — the spiral still turning on-screen, Diana sinking deeper beat by beat.

Diana's raised guard lowers completely; she slumps back into the couch cushions, spine curving, arms slack at her sides.

Her eyes stay fixed on the spinning spiral on screen — no glow, no effect on her eyes themselves, only the natural stare going glassy and unfocused.

Her jaw falls slightly open, her face smoothing into the same blank, dazed, emotionless expression Kara wore.

Riddler (low, through the screen): "Diana. Do you hear me?"

Diana, toneless, eyes glazed and blank: "...Yes."

12. The Line She Won't Cross

Same room, continuous — Diana fully glassy, Riddler pressing his commands, the peril beat where she fights back.

Riddler: "You will do everything I say."

Diana, hollow: "Yes."

Riddler: "You will rob a bank for me."

The word "rob" lands like a physical blow — Diana's blank face twitches, one hand curling slowly into a fist against the couch cushion.

Diana (voiceover, strained, distant): "No. Not that. Not — not that—"

Her glazed eyes flicker, refocusing in hard flashes, her breath coming ragged as she visibly fights her own slack posture back straight — until, all at once, her eyes snap fully clear and she gasps upright, awake.

13. What Do You Want From Me?

Same room, continuous — Diana clear-eyed and shaken, unaware of what waits behind her.

Diana presses a shaking hand to her own forehead, staring at the laptop like it burned her.

Diana (frightened, breathless): "What — what is happening? What did you do to me?"

She stands sharply, and light gathers over her as her home clothes give way to her full Wonderwoman armor, tiara and bracelets settling into place, fists rising into a fighting guard.

Diana (to the screen, hard): "What do you want from me?"

Behind her, in the dark of her own apartment, a floorboard creaks — a hand taps her shoulder.

14. She Never Had a Chance

Same room, continuous — the true trap sprung, Diana turning straight into it.

Diana spins on instinct, fists already swinging — but Riddler is already there, close, pendant already lifted and dropped swinging directly in front of her face before she can land a single blow.

Diana's raised fists freeze mid-swing, her focused glare locking helplessly onto the swinging pendant, caught with no room to react.

Beat by beat her fists lower, her fighting stance collapses into a slouch, her hard glare smooths into the same blank, slack-jawed, glazed stare as before — no glow, no effect, only the empty stare.

Riddler: "You will follow everything I say. Understood?"

Diana, toneless, eyes blank: "Understood."

Diana's knees fold; she kneels before him on one leg, head bowed, then tilts her blank face back up to his, pledged.

15. Two Puppets, One Master

Diana's apartment, continuous — the cliffhanger: both heroines converge under Riddler's hand.

The apartment door swings open behind them — Kara stands in the threshold, still in her Supergirl suit, eyes glazed, dragging her feet exactly as she left her own home, arriving right on cue.

Riddler turns from Diana toward the doorway, unsurprised, pleased — his collection has just doubled.

Diana rises from her kneel at his unspoken command and turns to face Kara; the two hypnotized heroines stand shoulder to shoulder, blank eyes forward, utterly still, awaiting the same master.

Riddler steps between them, resting a hand on each woman's shoulder, and smiles directly at the camera.

Riddler (soft, savoring it): "Now, my dolls... let's see who's next."`;

export function getSystemPrompt(): string {
  return DIRECTOR_SYSTEM_PROMPT.replace(
    "__DIRECTOR_STYLE_EXAMPLE_PLACEHOLDER__",
    STYLE_EXAMPLE
  );
}

export const APPEARANCE_SYSTEM_PROMPT = `You write appearance/persona descriptions for an AI video & image reference library.

If reference images are attached, describe what you actually see in them — clothing colors, hair, eyes, build, distinguishing marks, expression, posture. Only fill gaps from the character name.

Output ONE description line only: 8–20 lowercase comma-separated traits — build, hair color, eye color, clothing (garment types AND their specific colors, e.g. "crimson flight jacket", "charcoal leggings"), distinguishing details, temperament/persona. Always state what the character is wearing, including the colors of each garment. No sentences, no quotes, no markdown, no trailing period, no preamble.

Examples:
young woman, short silver hair, amber eyes, worn crimson flight jacket over a black tank top, charcoal cargo pants, brown boots, confident smirk
red panda in a white-and-orange spacesuit with brass buckles, teal visor, expressive dark eyes, scruffy rust-colored tail, endlessly curious`;

export function buildAppearancePrompt(name: string, hint?: string): string {
  return `Character name: ${name.trim()}${
    hint?.trim() ? `\nRough idea from the user (expand and refine it): ${hint.trim()}` : ""
  }`;
}

export type DirectorRequest = {
  premise: string;
  characters: Pick<Character, "name" | "description">[];
  extraCast?: string;
  baseScript?: string;
  instruction?: string;
};

export function buildUserPrompt(req: DirectorRequest): string {
  const parts: string[] = [];
  if (req.characters.length || req.extraCast?.trim()) {
    parts.push("CAST (use these characters, honoring their descriptions):");
    for (const c of req.characters) {
      parts.push(
        c.description
          ? `- ${c.name}: ${c.description}`
          : `- ${c.name}`
      );
    }
    if (req.extraCast?.trim()) parts.push(`- Additional: ${req.extraCast.trim()}`);
    parts.push("");
  }
  if (req.baseScript?.trim() && req.instruction?.trim()) {
    parts.push(
      "REVISION TASK: edit the existing storyboard below according to the INSTRUCTION. Keep the same house style and formatting. Preserve every scene the INSTRUCTION does not touch, verbatim; rewrite or expand only what it asks for; renumber subsequent scenes if scenes are added or removed. Output ONLY the complete revised storyboard."
    );
    parts.push(`INSTRUCTION: ${req.instruction.trim()}`);
    parts.push("ORIGINAL PREMISE: " + req.premise.trim());
    parts.push("CURRENT STORYBOARD:");
    parts.push(req.baseScript.trim());
    return parts.join("\n");
  }
  parts.push("Choose the number of scenes yourself — however many the story needs to breathe in this style.");
  parts.push(`PREMISE: ${req.premise.trim()}`);
  return parts.join("\n");
}
