---
name: wan3.0-r2v-ref
description: Use when a user asks an Agent to organize a material-to-video request with image, video, or audio references into a clean, structured R2V generation request. The skill formats and clarifies the user's own instructions only, without enriching the story.
metadata:
  skill_version: 0.2.0
  owner: wan3.0
  tags:
    - r2v
    - request-formatting
    - multimodal-video
  supported_runtimes: []
  required_capabilities:
    filesystem_read: false
    filesystem_write: false
    tool_use: false
    network: false
    binary_outputs: false
  io_contract:
    output_kind: text
    primary_outputs:
      - structured_request
  exports: []
---

# Wan 3.0 R2V Request Organization

## Purpose

Organize the user's raw text request and image, video, and audio material references into a clean, structured R2V (reference-to-video) generation request. The output adopts a five-section structure: [Core Task], [Plot Summary], [Audio Style], [Camera & Core Constraints], and [Negative Prompts]. The user's core intent is preserved; material references are consolidated in [Core Task], and subject mappings are reflected naturally at plot nodes.

This stage only performs formatting and organization:

- Only organize the storyline, subjects, dialogue, and reference requirements the user has already provided. Do not enrich the plot or add content the user did not request.
- The output will be passed to a downstream prompt enhancement (PE) stage for further processing. This stage is only responsible for clarifying the input; generation-specific expressions are handled by subsequent stages.
- Materials are treated as read-only — original materials are not modified, nor are auxiliary materials self-created.
- Under no circumstances should the video generation API be called directly. When the user requests video generation, first produce the organized request, then hand it off to the subsequent workflow.

## Applicable Scenarios

Load this Skill when:

- The user provides image, video, or audio material references and requests organization or normalization into an R2V generation request.
- The user requests generating a new video referencing characters, objects, scenes, composition, lighting, style, motion, camera movement, editing, effects, or sound from the materials.
- The user requests using images as starting, intermediate, or ending visual nodes, or embedding full video or audio segments into the final output.
- The user requests generating and connecting new content before, after, or between two material segments.
- The user provides a brief idea, a long description, or an unorganized complex request that needs to be structured into a directly usable request.

Do NOT use this Skill when:

- **Storyline remaking requests**: The user explicitly asks to "remake, subvert, adapt, remix, re-create, re-interpret, or reshoot" the existing plot of an input video. This is a storyline remaking task — inform the user that the corresponding remaking workflow is needed.
- **Direct editing of input video files**: Deleting, replacing, or repairing existing visual, audio, or timeline objects in the original video. Such requests can be passed as-is to the downstream stage without organization.
- The user is only asking about API parameters, pricing, quotas, error messages, or model capabilities.

The determining criterion is the target output: use this Skill when generating a new video conditioned on materials; do not use it when the final output must directly modify the original video's timeline. When the input contains no video, this Skill is always used.

## Inviolable Principles

1. **Intent Priority**: Character identities and counts, key props, scenes, event causality, spatial relationships, and story outcomes must all remain as stated in the user's original text.
2. **Structure Priority**: Regardless of whether the original request is complete, always reorganize into the corresponding template. Only structural reorganization beyond synonymous rewriting is performed.
3. **Per-Material Accountability**: For each actually used material, specify what is adopted and the scope of reference.
4. **User Mapping Priority**: Material roles, subject names, and relationships explicitly specified by the user remain as-is. When a user mapping already covers a corresponding role, do not assign unnamed materials to the same role.
5. **Minimal Clarification**: Complete directly when content can be reasonably inferred from text, materials, and context. Only ask one consolidated question for issues that would change the core outcome and have multiple equivalent interpretations.
6. **Output Only Submittable Content**: The entire response consists of the request body. Opening confirmations, closing summaries, analysis processes, organization notes, and modification rationale remain in the internal organization stage.
7. **Parameter Separation**: Aspect ratio, total duration, resolution, and frame rate are set by the page or API; they are used for event density planning and are not written into the request body. Event time segments originally written by the user are creative content and remain as-is.
8. **No Unwarranted Constraints**: Only organize the requirements the user has provided. Quality enhancement packs, watermarks, logos, subtitles, or other generic negative constraints the user did not request remain omitted.
9. **Single Best Version**: By default, output only one organized request. Output multiple versions only when the user explicitly requests a comparison.
10. **Fact vs. Observation Separation**: Character identities, ages, relationships, events, and outcomes are based on the user's text; materials only supplement directly visible or audible attributes. Material observations and plot facts are treated separately.
11. **Subject Cardinality Matching**: A single character design image corresponds to one character; multiple single-person candidates are assigned one image per person, and multiple group candidates are assigned one image per group. References are merged only when the same subject has multiple viewpoints, or the material frame itself contains the same group.

## Input States

First determine which state the input belongs to, then process the content.

### Pure Text-to-Video

The user has no materials, and the text does not express any reference needs. Directly extract subjects, events, scenes, camera, and audio, and apply the base template. Do not fabricate material IDs, and do not suggest the user add materials.

### Reference Needed but No Materials Provided

Material references already written in the user's request must be preserved as-is, including `ImageN`, `VideoN`, `AudioN`, or equivalent tags in the runtime environment. Do not delete, renumber, or rewrite them as no-reference requests because the corresponding materials are not attached in the current message or cannot be read in the current environment.

Continue organizing the request per the user's text, preserving their material roles and reference relationships. Do not claim to have viewed materials, and do not supplement details that can only be confirmed by viewing materials. When the user has not written material references, do not add new ones. Material inaccessibility only limits facts that can be confirmed; it does not block organization.

### Materials Readable

Proactively read the images, videos, and audio provided by the user. First do a lightweight inventory of all materials, then establish mappings in conjunction with the request. Avoid guessing material content from filenames alone.

### Material Specification Pre-check

When there are many materials, remind the user to be mindful of submission limits. If still within a reasonable range, continue organizing, reducing mutual interference between materials through per-material role assignment and scene-based activation. When reduction is necessary, first output the complete request, then append a `Material Note:` line after the body indicating materials that need to be reduced before submission.

### Material Numbering

Images, videos, and audio uploaded this time are numbered separately within each modality by upload order: Image1, Image2, Video1, Audio1, etc. Numbering only identifies materials and is unrelated to their order of appearance in the final output. The numbering and reference forms in the user's original request are preserved faithfully throughout.

## Core Workflow

### 1. Parse User Intent

First establish a "story contract" from the user's text, then cross-check material references. Extract and lock down:

- Subjects and their counts.
- Actions, events, and causal sequences.
- Scenes, time, weather, and spatial relationships.
- Prop ownership, handoffs, and final states.
- Camera, audio, dialogue, and subtitle needs.
- Camera timestamps — preserve as many as the user wrote.
- Content the user explicitly requested to keep or exclude.

The story contract is the factual boundary of the organization: every event, subject, and line of dialogue in the output can be traced back to the user's original text. Do not replace or merge because more prominent content appears in the materials.

Whenever the input contains speaking, dialogue, or narration, record the speaker, verbatim dialogue, language, and on-screen or off-screen position for each instance. Dialogue fragments provided by the user are preserved verbatim; when the user only describes the intent to speak without providing the original text, preserve that intent description and do not fabricate dialogue.

List every explicitly mentioned character, group, key prop, and scene in an internal "Required Entity Checklist." Confirm that every entity has been incorporated into the request before completing organization.

Words such as "replace" or "substitute" in the user's request describe reference relationships (e.g., having the character in Image1 perform the action from Video1). When organizing, express this as "who is doing what," clearly mapping the correspondence between characters and actions, scenes, and other references.

### 2. Inventory and Understand Materials

When there are many materials, use a two-pass understanding:

1. First pass: lightly inventory all materials, identifying candidates for characters, products, props, scenes, actions, camera movement, audio, and style.
2. Second pass: deeply examine only materials that match the plot, have conflicts, or serve as key frames.

When examining videos, confirm at minimum the subject, main actions, camera changes, and opening/closing states. When examining audio, confirm at minimum the sound type, timbre, language, dialogue content, or environmental sound purpose.

Distinguish two types of information:

- **Story Assignments**: Character names, ages, relationships, which events they handle, prop ownership, and endings. These come from the user's text.
- **Material Observations**: Facial features, hairstyles, clothing, materials, colors, spatial layout, actions, camera movement, timbre, and other characteristics that can be directly observed or heard.

Materials only supplement directly observable characteristics. Brands, professions, personalities, and prop functions that cannot be confirmed from materials are not supplemented. When the user only refers to "the person" or "the subject," continue using that neutral term. When the user has already given a character name or identity, use that term.

Mapping priority is fixed as:

```text
User explicit specification > Description in the request > Material content > Filename and metadata > Upload order
```

When the user's explicit mapping already covers all required entities, other unnamed available materials do not participate in the current task by default.

### 3. Establish Material Roles and Subject Mapping

Each used material bears only a clear role:

- **Images**: Character appearance and clothing, product structure and materials, props, scene layout, lighting, or as visual nodes.
- **Videos**: Actions, camera movement, rhythm, timeline, or as complete visual segments in the final output.
- **Audio**: Speaker timbre and dialogue, environmental sound, sound effects, or music, or as complete audio segments in the final output.

When establishing mappings, execute in the following order:

1. Take each unassigned character, group, prop, and scene from the Required Entity Checklist one by one.
2. Browse all material candidates, comparing headcount, clothing layers, silhouette, structure, and role match. After finding the first usable material, continue scanning the remaining candidates.
3. Select the best-matching material for the current slot, then proceed to the next slot. Different named characters use different best candidates by default.
4. After completion, perform a gap audit: each required entity bears exactly one clear role, and each used material bears only its declared role.

In the final material reference writing, each entry defines only one subject, prop, or scene with its reference material and adoption scope. Multiple subjects are split into separate entries, for example:

```text
Character A corresponds to Image1, adopting facial features, hairstyle, and clothing.
Character B corresponds to Image2, adopting facial features, hairstyle, and clothing.
Prop A corresponds to Image3, adopting structure, material, and color.
Scene A references Image4, adopting spatial layout, architecture, and lighting. The person in the image is ignored.
```

When the same subject has multiple references, state which viewpoint or attribute each material supplements, and declare that they jointly define the same entity, generating only one instance.

When two references conflict, defer to the user's specification first. When the user has not specified, assign by clarity and plot match. Only when the core identity still cannot be determined, ask one consolidated question.

### 4. Handle Mapping Confidence

- **High confidence**: Map directly and continue.
- **Medium confidence**: Adopt the most reasonable mapping directly and continue organizing, assuming it will be reflected naturally in the corresponding content of the body.
- **Low confidence, does not affect core outcome**: Do not use that material; do not ask the user.
- **Low confidence, affects core identity, count, prop ownership, spatial relationship, or key visual role**: Consolidate the relevant ambiguities into one concise question and wait for the answer before outputting the request.

Missing items such as style, lighting, ordinary camera movement, and others that can be conservatively decided from context do not interrupt the user.

### 5. Apply Template and Purify

Select the corresponding template below, retaining only the sections needed for the current task. Replace all placeholder content with specific information. Template instructions themselves do not remain in the output. After completion, perform the "Final Self-Check," then deliver per the "Output Contract."

## Templates

### Generation with Reference Materials

```text
[Core Task]
Generate a <genre or type> <video content overview>, referencing the <appearance/action/scene/timbre, etc. adoption content> of <subject or content> in <VideoN/ImageN/AudioN>. The entire film adopts <global style tone>.
Material references are consolidated here; timbre references are written as "the timbre of <character> references AudioN."

[Plot Summary]
1. <Plot node one: characters, actions, events; user dialogue preserved verbatim and bound to the speaker>.
2. <Plot node two...>; using the timbre of AudioN, say: "<verbatim original text>".
<Timbre references are written at the corresponding speaking nodes.>
<When the user has written timestamps for shots, the corresponding node begins with "ShotN xx-xx sec," with timestamps preserved verbatim from the user's original text; when the user has not written timestamps, keep pure node numbering.>

[Audio Style]
<Dialogue language and texture, live sound effects, emotional and rhythmic direction of the music.>
<When the user has not mentioned this, keep a brief summary or omit the entire section.>

[Camera & Core Constraints]
<Camera style, movement methods, editing rhythm, and hard constraints specified by the user.>
<When the user has not mentioned this, keep a brief summary or omit the entire section.>

[Negative Prompts]
<Comma-separated items the user explicitly excluded. Output this section only when the user explicitly requests excluding certain content.>
```

Section retention rules: [Core Task] and [Plot Summary] are always output. [Audio Style] and [Camera & Core Constraints] are output according to the detail level of the user's input; when the user has not mentioned them, keep them brief or omit them. [Negative Prompts] is output only when the user requests excluding content. Simple tasks may retain only the core sections.

Filling example (simple task; audio and camera not mentioned by the user):

```text
[Core Task]
Generate a hands-on restoration video of an old wooden chair, referencing the woodworker's appearance in Image1 and the old wooden chair's look in Image2, and referencing the hand movements of applying glue and pressing in Video1. The entire film adopts a plain and natural lifestyle documentary style.

[Plot Summary]
1. The woodworker inspects the loose backrest joint.
2. The woodworker applies wood glue following the technique in Video1 and presses the backrest back into position to secure it.
3. The woodworker releases both hands; the backrest remains sturdy.

[Audio Style]
Only retain live sounds such as wood friction and light tool clicks; the person remains naturally silent.
```

### Complete Image Reference

When the user requests an entire image to serve as a visual frame in the final output, write the following into the corresponding sections:

- The image's position is written into [Core Task]: opening frame, key process frame, or ending frame. When there are multiple images, specify the order.
- The connection method between the image and adjacent content is written at the corresponding node in [Plot Summary]: continuous transition, or generating new content before/after the image.
- Subjects, states, and spatial relationships to be preserved in the image are written at the corresponding plot node. Actions and environmental changes before and after the image remain naturally continuous.
- Multi-grid images are described cell by cell in reading order; subject references uniformly use the whole-image number.

### Complete Video Segment Reference

When the user requests a complete video or a specified segment to be included in the final output, write the following into the corresponding sections:

- The segment position is written into [Core Task]: opening, middle, or closing segment of the final output.
- The continuation after an opening video, the lead-in before a closing video, and the connections before and after a middle video are written at the corresponding nodes in [Plot Summary].
- The segment content is faithfully summarized into [Plot Summary] based on the actual characters, actions, events, and audio presented. Language and speech therein are written per speaker, language, and verbatim original text.
- Subject, spatial, and audio continuity is maintained between the segment and the generated content.

### Complete Audio Reference

When the user requests using audio in full, write the following into the corresponding sections:

- The usage scope is written into [Core Task]: throughout the entire film, or only occupying a specific continuous segment of the final output and its position.
- The vocal, music, environmental sound, and sound effect content carried by the audio is written into [Audio Style]. Confirmed language content therein is written into the corresponding node in [Plot Summary] per speaker and verbatim original text.
- The correspondence between the audio and visual events is written at the corresponding plot node.

### Sound and Dialogue

- Dialogue, narration, and lyrics provided by the user are preserved verbatim in the corresponding node in [Plot Summary], with the speaker and language specified.
- Timbre references are declared in [Core Task] as "the timbre of <character> references AudioN," and at the speaking node in [Plot Summary] as "using the timbre of AudioN, say: 'verbatim original text'."
- For tasks without dialogue, state that the person remains naturally silent, the sound sources, and the retained environmental sounds.
- When the user explicitly requests on-screen subtitles, specify the subtitle content and display position. When the user has not requested subtitles, omit them.

## Output Contract

- The output language follows the user's primary instructions: when the main instructions are in Chinese, output in Chinese; when in English, output in English. Dialogue, lyrics, and on-screen text within quotation marks are preserved in the original language.
- The entire response consists of the organized request body, beginning directly with the [Core Task] section. When material limits or individual restrictions need to be noted, append a single `Material Note:` or `Supplementary Note:` line after the body.
- Material reference numbers are preserved faithfully from the user's original request, using the same numbering system throughout.
- Aspect ratio and total duration are used only for event density planning and always exist as page or API parameters.
- When materials exceed submission limits, first output the complete request, then append a `Material Note:`. When individual facts cannot be confirmed because materials are not readable and the user's original text is preserved, append a `Supplementary Note:`. The body itself remains directly usable.

## Final Self-Check

Confirm each item before outputting:

- Character identities and counts, event causality, prop ownership, spatial relationships, and story outcomes are consistent with the user's original text.
- The output is structurally organized through the template; every event, subject, and line of dialogue can be traced back to the user's original text.
- Each actually used material has a unique and clear role and adoption scope.
- Material references are consolidated in [Core Task]; timbre references are written at the corresponding speaking nodes.
- Different characters, props, and scenes are bound individually; one entry corresponds to only one subject.
- A single character design image corresponds to one character; when multiple materials jointly define the same subject, this is explicitly declared.
- Material references in the user's original request are preserved as-is. When materials are not readable, no claim of having viewed them is made, and no unconfirmable details are supplemented.
- Dialogue, narration, lyrics, and language content specified by the user are preserved verbatim; speaker and language attributions are correct.
- Aspect ratio and total duration exist as planning parameters; no API parameters appear in the body.
- Storyline remaking and direct editing requests have been identified as out of scope, and the corresponding handling method has been explained.
- The output begins with the [Core Task] section; [Core Task] and [Plot Summary] are present; [Audio Style] and [Camera & Core Constraints] are included or omitted based on the user's input detail level.
- [Negative Prompts] appears only when the user explicitly requests excluding content; all content comes from the user's exclusions.
- Camera timestamps are carried into [Plot Summary] verbatim from the user's original text. When the user has not written timestamps, each node retains pure numbering.
- The response consists solely of the request body, beginning and ending directly with body sections.

## Complete Input-to-Output Examples

### Example 1: Emergency Room Resuscitation (Appearance Reference plus Timbre Reference)

User request: `Generate a modern emergency room resuscitation scene as a medical-themed TV drama clip. The doctor's appearance references Video1. Shin Dong-ok's timbre references Audio1. The entire film uses handheld tracking shots and rapid editing. Shot breakdown: Shot1 0-3 sec, Shot2 3-6 sec, Shot3 6-8 sec, Shot4 8-10 sec, Shot5 10-12 sec. Dialogue: Shin Dong-ok shouts "잠깐만요! 들어가요!", the attending doctor says "하나, 둘, 셋.", "한 번 더.", "내 말 들려요?", "눈 떠봐요.", "인튜베이션.", and a doctor in scrubs calls out "사부님." The ending freezes on Lee Sung-kyung's extremely shocked expression as she puts on the isolation gown. Avoid: slow pacing, calm atmosphere, exaggerated acting, stiff movements, overly clean and tidy scene, stable shots, tripod or jib use, slow motion, lyrical music, medical procedure errors, fake props, identity drift, facial distortion, CG look, plastic texture, blurry footage, unrealistic lighting.`

Output the following request body:

[Core Task]
Generate a modern emergency room resuscitation scene as a medical-themed TV drama clip, referencing the doctor's appearance in Video1 and Shin Dong-ok's timbre in Audio1. The entire film adopts a strongly subjective handheld tracking style with rapid editing, building a life-or-death tension.

[Plot Summary]
1. Shot1 0-3 sec: A doctor (Shin Dong-ok) and colleagues rush a gurney carrying a young male patient with a leg cast into the resuscitation room. He shouts: "잠깐만요! 들어가요!".
2. Shot2 3-6 sec: The group surrounds the gurney. The attending doctor directs: "하나, 둘, 셋." and begins chest compressions on the patient, ordering: "한 번 더." A woman (Lee Sung-kyung) bursts in, removing her coat to assist.
3. Shot3 6-8 sec: The attending doctor attempts to wake the patient: "내 말 들려요?" then issues orders: "눈 떠봐요.", "인튜베이션.".
4. Shot4 8-10 sec: A doctor with the appearance from Video1 (wearing navy blue scrubs and a light blue isolation gown) tensely calls out while using a surgical instrument: "사부님.".
5. Shot5 10-12 sec: The final shot freezes on Lee Sung-kyung's extremely shocked expression as she puts on the isolation gown, serving as the ending.

[Audio Style]
Audio consists of urgent Korean dialogue, gurney rolling sounds, monitor beeping, and other live sound effects, along with an electronic beat soundtrack that continuously builds tension.

[Camera & Core Constraints]
Strongly subjective handheld tracking style; the camera closely follows characters with natural shake. Uses rapid action cuts, switching between different characters and actions to highlight chaos and urgency. No slow motion, no unnecessary transition effects.

[Negative Prompts]
slow pacing, calm atmosphere, exaggerated acting, stiff movements, overly clean and tidy scene, stable shots, tripod or jib use, slow motion, lyrical music, medical procedure errors, fake props, identity drift, facial distortion, CG look, plastic texture, blurry footage, unrealistic lighting

### Example 2: Complete Video Opening Segment plus Continuation

User request: `Continue the story from Video1 as the opening. The character in Image1 receives the bouquet and smiles in thanks. Image3 is his timbre, saying "非常感谢".`

Output the following request body:

[Core Task]
Use Video1 as the opening segment of the final output and continue the story with a video in which the character receives a bouquet and expresses thanks. In the continuation, the character's appearance references Image1 and the character's timbre references Audio3. The entire film maintains the visual tone established by Video1.

[Plot Summary]
1. Video1 serves as the opening segment, presented in full with its original visuals, audio, and event sequence preserved.
2. The character from Image1 receives the bouquet with both hands, brings it to their chest, and nods with a smile to thank the other person, using the timbre of Audio3 to say: "非常感谢."
3. After the handoff, the bouquet remains only in that character's hands.

[Audio Style]
Video1's opening segment retains its original audio; the continuation retains live environmental sounds and vocals, with the music naturally settling as the gratitude emotion concludes.

[Camera & Core Constraints]
Camera style remains continuous from Video1 to the continuation. Subject, scene direction, and audio relationships are coherent; the character's appearance and clothing remain stable.

## Compatibility And Runtime Notes

- **Text-only Agent**: Processes the user's text and explicitly referenced material tags, maintaining an honest attitude toward unread materials.
- **Multimodal Agent**: Reads images, video, and audio within the limits allowed by the runtime, performing two-pass material understanding and automatic mapping.
- **No filesystem access**: Preserves the user's existing material numbers and reference forms; processes inaccessible materials through the "reference needed but no materials provided" degradation path.
- **No network access**: Maintains reference form for remote material addresses; material content is based on the user's text.
- **Output only**: This Skill outputs text only. File writing, network, tool invocation, and binary output capabilities remain disabled.
