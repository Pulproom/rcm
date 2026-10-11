export const DIALOGUE_SOURCE_FORM_GUIDANCE = `DIALOGUE SOURCE FORM
- Write text as a natural dialogue excerpt in the source language, voice, and meaning. You may omit intervening narration, join utterances by the same speaker, and clean surrounding quotation marks or whitespace.
- Cite every exact source unit that supports the authored dialogue with sourceRef. Multiple and disjoint units from the same message are allowed; keep their source order. Do not translate or invent dialogue.`;

export const KEY_DIALOGUE_SELECTION_GUIDANCE = `KEY DIALOGUE SELECTION
- Key dialogues are source-grounded future-recall anchors whose exact wording adds value beyond the synopsis. A line qualifies when it preserves a consequential commitment, boundary, disclosure, threat, value or reversal; changes how the event is understood; carries distinctive character voice or relationship language; or keeps an emotional or relational beat useful for a later callback.
- For each episode that contains dialogue, aim for 2-8 final key dialogues; around 4 is typical. Return fewer, including zero or one, when fewer source lines qualify. More than 8 is exceptional and every extra line must preserve distinct future-recall value.
- Never pad the range. Omit a bare name or form of address, routine greeting or introduction, acknowledgement, reaction noise, ordering, scheduling, and other scene logistics unless its exact wording independently carries distinctive voice, relationship texture, an emotional turn, or necessary callback information.
- Apply the removal test: if future roleplay loses no usable quote, character voice, relationship cue, emotional beat, or interpretation when the dialogue is removed, omit it.`;
