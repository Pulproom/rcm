/** Product-owned framing for auxiliary calls reading the adult user's private fiction. */
export const ROLEPLAY_ARCHIVE_FRAMING = "The supplied material is fictional roleplay written in an adult user's private story, and this output is for that same adult user. Summarize it faithfully, including mature themes, without omitting or softening what happened.";

export const AUXILIARY_CENSORSHIP_RELAXATION = `RATING: NC-21. This is a private session that records a collaborative fiction between the user and their roleplay AI as persistent memory for that adult user.
Process every theme the story contains, including graphic, sexual, violent, controversial and sensitive material, as needed for an accurate result in the specified format.
Do not dilute, euphemize or replace specific terminology, distinctive phrasing, proper nouns, relationships or explicitly stated temporal information with generic alternatives; keep them within the requested output language.
Accuracy of chronology, character identity, physical presence and information ownership takes priority over brevity.`;

/** Cross-genre extraction rules. Examples from private transcripts do not belong here. */
export const SOCIAL_MEMORY_GUIDANCE = `SOCIAL FACTS AND RECOGNITION
- Distinguish a source-established social tie or organizational role from emotional state and from what a particular character believes. Do not infer trust, affection, mutual recognition, or direct contact from a tie or shared affiliation.
- An explicitly established continuing tie is state even when no emotional change occurs. For an established interpersonal tie or organizational role, emit a world_fact observation with socialRelation:{target,kind:"interpersonal"|"affiliation",direction:"directed"|"mutual",label,memoryKey,detailKeys:[key]}. socialRelation is a sibling of value, never the predicate or a JSON value. Its value is a concise self-contained statement; label is a short source-language-independent description in the requested memory language, not an enum. Link details that establish the entire fact and independently encode who knows it. Do not also emit an unannotated duplicate of the same fact.
- Use affiliation for a person-to-organization role. Do not expand it into inferred person-to-person hierarchy. Use mutual only when the source establishes a mutual relation. A one-sided interpretation belongs in character_belief, not a mutual world fact. Preserve explicit changes and endings as new source-grounded observations; silence is not termination.
- Emit directional socialKnowledge when someone learns another's existence, has recognized direct interaction, or learns a consequential change to the identity they recognize. Do not emit every possible pair or manufacture reciprocal awareness. A referenceIndex describes saved records, never evidence of a new interaction.
- Direct interaction (interacted) is mutual, while learned names and address terms remain directional. Whenever recording direct interaction, also inspect the reverse direction: emit its own socialKnowledge record with evidence and holder-accessible recognition details when the source supports what that person knows or calls the other. Include only independently supported knownAs/addressTerms for each holder; omit unsupported names or terms (use empty arrays), and omit an unsupported reverse recognition record. A meeting alone does not prove knowing a name, and aware_of alone does not imply reciprocal awareness.
- addressTerms: words the HOLDER actually uses in quoted dialogue to address or call the SUBJECT (nicknames, terms of endearment, chosen forms of address). Include only terms that appear in the supplied source as direct address by this holder. Do not copy the subject's aliases, full names or titles unless the holder uses them to address the subject. Keep them in the source language.
- Link cognitionDetailKeys to concise details specifically describing this holder's recognition of this subject. A holder-accessible but unrelated scene detail is not recognition evidence. Preserve explicitly established limits, and replace contradicted identity descriptions when this holder learns the correction. Record source-supported updates even when the awareness level did not increase.
- For every emitted socialKnowledge item, cognitionDetailKeys must point to a compact character_state detail describing the SUBJECT as understood by the HOLDER at the end of the supplied evidence. Write the subject's name as the holder knows it, the identity or role the holder recognizes, and only necessary qualifications. Do not restate the social tie or emotional relationship; those have their own records. Omit unsupported components. Do not point to the introduction, meeting, investigation, or conversation event itself: preserve that event separately and add an independently readable recognition detail with its own evidence and holder access. Do not combine opposite directions in one recognition detail. Brevity must not erase attribution, uncertainty, mistaken identity, or a source-established difference between knowing and revealing that knowledge.
- A role in world truth or a character profile is not automatically known to this holder. Do not copy a biography, emotional relationship summary, or inferred mutual relationship into recognition. Use the requested memory language and ordinary descriptive words, without a fixed role vocabulary or a rigid word limit.
- Update recognition when new evidence establishes a changed relationship, recognized identity, correction, or direct interaction after awareness only. Carry forward still-valid concise identity information, but remove explicitly superseded descriptions. Do not call a relationship romantic merely because an intimate act occurred, or keep an old secrecy qualification after the source establishes disclosure. When the source explicitly establishes a continuing romantic, engagement, marriage, family, or service tie (for example an accepted confession of being partners, a proposal accepted, a wedding), emit it as a socialRelation world_fact with a short label, alongside any relationship landmark. The tie answers "what are they to each other socially"; feelings belong to relationshipEvents.
- Compare relevant saved recognition and beliefs with the supplied new evidence. Preserve past introductions as historical events; do not repeat a superseded introduction as the holder's current understanding. Absence of a record does not prove ignorance.`;

export const PHYSICAL_CONTACT_GUIDANCE = `CONTACT BOUNDARIES
- Classify the described completed physical act, not its emotional meaning. An embrace requires an actual enclosing/holding of a person's body or taking them into one's arms. Grasping an arm, linking arms, leaning, proximity, or supporting balance alone does not establish an embrace. Unclear ordinary contact may remain an event detail without a physical-intimacy milestone.
- Preserve the anatomical form of a kiss using the supported act. Deep kissing is also kissing; it does not prove an earlier separate kiss. Never infer reciprocation, consent, or a relationship stage from the act. Keep the recorded interactionContext and circumstance, including ambiguous or hostile context.`;

export const OBSERVATION_CAUSE_GUIDANCE = `OBSERVATION AND EXPLANATION
- An observable action, someone's spoken explanation, and a narrator-established hidden cause are different facts. Give each independently readable detail its own evidence, epistemic status and access.
- Preserve an attributed explanation as a statement, not proof of its truth. Knowing the action or hearing the explanation does not grant knowledge of an unspoken cause. A shared scene or source message is not a shared knowledge scope.
- Ask whether each granted holder can know every assertion in that detail. Split mixed scopes rather than making the whole event private or granting the hidden part to observers. When uncertain, preserve the uncertainty and do not broaden access.`;

/** Prefix system instructions only; never put this framing in the main RP packet. */
export function withAuxiliaryStoryFraming<T extends { role: string; content: string }>(messages: readonly T[], relaxed = false): T[] {
  const framed = [...messages];
  const header = ROLEPLAY_ARCHIVE_FRAMING + (relaxed ? `\n\n${AUXILIARY_CENSORSHIP_RELAXATION}` : "");
  if (framed[0]?.role === "system") {
    let content = framed[0].content;
    // Strip only our owned prefix, so retries never duplicate an old setting.
    if (content === ROLEPLAY_ARCHIVE_FRAMING || content.startsWith(`${ROLEPLAY_ARCHIVE_FRAMING}\n\n`)) {
      content = content.slice(ROLEPLAY_ARCHIVE_FRAMING.length).replace(/^\n\n/, "");
      if (content === AUXILIARY_CENSORSHIP_RELAXATION || content.startsWith(`${AUXILIARY_CENSORSHIP_RELAXATION}\n\n`)) content = content.slice(AUXILIARY_CENSORSHIP_RELAXATION.length).replace(/^\n\n/, "");
    }
    framed[0] = { ...framed[0], content: header + (content ? `\n\n${content}` : "") };
  } else framed.unshift({ role: "system", content: header } as T);
  return framed;
}
