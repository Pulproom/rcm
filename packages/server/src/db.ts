import { migrateTranslationKeys } from "./translation-cache.js";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { randomUUID } from "node:crypto";
import { isInitialCalibrationMemory } from "@rcm/shared";

export type RcmDatabase = Database.Database;
export const DATABASE_SCHEMA_VERSION = 52 as const;

const entityColorColumn = "color TEXT CHECK(color IS NULL OR color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')";

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  chat_title TEXT,
  character_id TEXT NOT NULL,
  profile TEXT NOT NULL CHECK(profile IN ('companion','simulation')),
  include_user_messages INTEGER NOT NULL DEFAULT 1,
  extraction_group_turns INTEGER NOT NULL DEFAULT 6,
  edit_protection_turns INTEGER NOT NULL DEFAULT 2,
  normalization_policy_json TEXT NOT NULL DEFAULT '{"useLightboard":false,"useGigaTrans":false,"customRules":[]}',
  completed_turn_count INTEGER NOT NULL DEFAULT 0,
  memory_language TEXT NOT NULL DEFAULT 'en' CHECK(memory_language IN ('en','ko','ja','zh')),
  pending_memory_language TEXT CHECK(pending_memory_language IS NULL OR pending_memory_language IN ('en','ko','ja','zh')),
  post_extraction_review INTEGER NOT NULL DEFAULT 0,
  is_internal INTEGER NOT NULL DEFAULT 0,
  ingestion_state TEXT NOT NULL DEFAULT 'managed' CHECK(ingestion_state IN ('historical_pending','managed','cleared')),
  revision INTEGER NOT NULL DEFAULT 0,
  static_hash TEXT,
  static_json TEXT,
  relationship_setup_fingerprint TEXT,
  relationship_pending_fingerprint TEXT,
  relationship_seed_status TEXT NOT NULL DEFAULT 'unseeded',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS initial_calibrations (
  chat_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unseeded',
  origin TEXT NOT NULL,
  setup_fingerprint TEXT,
  confirmation_required INTEGER NOT NULL DEFAULT 0,
  locked_at INTEGER,
  confirmed_at INTEGER,
  last_error TEXT,
  setup_json TEXT,
  pending_force_backfill INTEGER NOT NULL DEFAULT 0,
  pending_extraction_review INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content TEXT,
  content_hash TEXT NOT NULL,
  canonical_content TEXT DEFAULT '',
  canonical_hash TEXT NOT NULL DEFAULT '',
  completed_turn_seq INTEGER,
  lifecycle TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  event_time INTEGER,
  generation_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'host',
  host_visibility TEXT NOT NULL DEFAULT 'active',
  extraction_state TEXT NOT NULL DEFAULT 'pending',
  memory_excluded INTEGER NOT NULL DEFAULT 0 CHECK(memory_excluded IN (0,1)),
  updated_at INTEGER NOT NULL,
  source_record_id TEXT,
  display_content_hash TEXT,
  display_comparison_hash TEXT,
  PRIMARY KEY(chat_id, message_id),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ordinal ON messages(chat_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_messages_extraction ON messages(chat_id, lifecycle, extraction_state);

CREATE TABLE IF NOT EXISTS message_revisions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  content TEXT,
  content_hash TEXT NOT NULL,
  canonical_content TEXT,
  canonical_hash TEXT NOT NULL DEFAULT '',
  lifecycle TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  purge_after INTEGER,
  FOREIGN KEY(chat_id, message_id) REFERENCES messages(chat_id, message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'transcript',
  setup_prominence TEXT NOT NULL DEFAULT 'supporting',
  source_json TEXT NOT NULL DEFAULT '[]',
  user_managed INTEGER NOT NULL DEFAULT 0,
  ${entityColorColumn},
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id, entity_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS aliases (
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized TEXT NOT NULL,
  PRIMARY KEY(entity_id, normalized),
  FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  start_revision INTEGER NOT NULL,
  end_revision INTEGER,
  status TEXT NOT NULL DEFAULT 'capsuled',
  start_ordinal INTEGER,
  end_ordinal INTEGER,
  source_tokens INTEGER NOT NULL DEFAULT 0,
  resolution TEXT,
  memory_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS episode_messages (
  episode_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  PRIMARY KEY(episode_id,message_id),
  FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY(chat_id,message_id) REFERENCES messages(chat_id,message_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_episode_messages_chat ON episode_messages(chat_id,ordinal);
CREATE TABLE IF NOT EXISTS episode_sections (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  key_dialogues_json TEXT NOT NULL DEFAULT '[]',
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_episode_sections_episode ON episode_sections(episode_id,ordinal);
CREATE TABLE IF NOT EXISTS evidence_spans (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  memory_id TEXT,
  message_id TEXT NOT NULL,
  quote TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  known_by_json TEXT NOT NULL DEFAULT '[]',
  perspective TEXT,
  story_time TEXT,
  story_time_normalized TEXT,
  locations_json TEXT NOT NULL DEFAULT '[]',
  landmark INTEGER NOT NULL DEFAULT 0,
  landmark_kinds_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  salience REAL NOT NULL DEFAULT 0.5,
  strength REAL NOT NULL DEFAULT 0.5,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_revision INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  capsule_parent_id TEXT,
  retention_class TEXT NOT NULL DEFAULT 'arc' CHECK(retention_class IN ('scene','arc','durable')),
  atom_access_version INTEGER NOT NULL DEFAULT 0,
  source_batch_id TEXT,
  user_managed INTEGER NOT NULL DEFAULT 0,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chat_id, memory_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memories_chat_active ON memories(chat_id, active, created_revision);
CREATE TABLE IF NOT EXISTS memory_dialogues (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  message_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_dialogues_memory ON memory_dialogues(memory_id, ordinal);
CREATE TABLE IF NOT EXISTS memory_details (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  detail_key TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supporting',
  original_kind TEXT,
  seed_json TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  known_by_json TEXT NOT NULL DEFAULT '[]',
  locations_json TEXT NOT NULL DEFAULT '[]',
  epistemic TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0.5,
  retention_class TEXT NOT NULL DEFAULT 'arc',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_start_ordinal INTEGER,
  source_end_ordinal INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chat_id,memory_id,detail_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_details_chat_kind ON memory_details(chat_id,active,kind,source_start_ordinal);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_detail_fts USING fts5(
  detail_id UNINDEXED,
  chat_id UNINDEXED,
  memory_id UNINDEXED,
  text,
  participants,
  locations,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  memory_id UNINDEXED,
  chat_id UNINDEXED,
  title,
  content,
  participants,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS memory_edges (
  chat_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  kind TEXT NOT NULL DEFAULT 'association',
  reinforced_at INTEGER,
  PRIMARY KEY(chat_id, source_id, target_id),
  FOREIGN KEY(source_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_traces (
  memory_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  salience REAL NOT NULL DEFAULT 0.5,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_revision INTEGER,
  last_recalled_turn_seq INTEGER,
  detail_level TEXT NOT NULL DEFAULT 'gist',
  distortion_type TEXT,
  PRIMARY KEY(memory_id,character_name),
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_activation_state (
  chat_id TEXT NOT NULL,
  perspective TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  activation REAL NOT NULL,
  via_memory_id TEXT,
  last_turn_seq INTEGER NOT NULL,
  path_expires_turn INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,perspective,memory_id),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_activation_lookup ON memory_activation_state(chat_id,perspective,last_turn_seq);

CREATE TABLE IF NOT EXISTS memory_recall_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('mentioned','recalled','reexperienced')),
  confidence REAL NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_batch_id TEXT,
  created_revision INTEGER NOT NULL,
  completed_turn_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(source_batch_id,memory_id,holder),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_recall_events_chat_holder ON memory_recall_events(chat_id,holder,created_revision);

CREATE TABLE IF NOT EXISTS assertions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value TEXT NOT NULL,
  state_kind TEXT NOT NULL DEFAULT 'condition' CHECK(state_kind IN ('condition','goal','secret')),
  social_relation_json TEXT,
  confidence REAL NOT NULL,
  valid_from_revision INTEGER NOT NULL,
  valid_to_revision INTEGER,
  valid_from_ordinal INTEGER,
  valid_to_ordinal INTEGER,
  source_memory_id TEXT,
  source_batch_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  retention_class TEXT NOT NULL DEFAULT 'arc',
  created_at INTEGER NOT NULL,
  user_edit_ordinal INTEGER,
  auto_locked INTEGER NOT NULL DEFAULT 0 CHECK(auto_locked IN (0,1)),
  automatic_closure_evidence_json TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assertions_current ON assertions(chat_id, subject, predicate, valid_to_revision);

CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value TEXT NOT NULL,
  polarity TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT,
  source_batch_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','disputed','pending_review')),
  superseded_by TEXT,
  retention_class TEXT NOT NULL DEFAULT 'arc',
  created_revision INTEGER NOT NULL,
  valid_from_ordinal INTEGER,
  valid_to_ordinal INTEGER,
  created_at INTEGER NOT NULL,
  user_edit_ordinal INTEGER,
  auto_locked INTEGER NOT NULL DEFAULT 0 CHECK(auto_locked IN (0,1)),
  automatic_closure_evidence_json TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_access (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis IN ('experienced','witnessed','told','heard','inferred','internal')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  source_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id,item_kind,item_id,holder),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_item_access_lookup ON item_access(chat_id,item_kind,item_id,active,holder);

CREATE TABLE IF NOT EXISTS extraction_audits (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_review','applied','failed','stale')),
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  source_fingerprint_json TEXT NOT NULL DEFAULT '[]',
  source_revision INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  patch_json TEXT,
  error TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(job_id),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_extraction_audits_queue ON extraction_audits(chat_id,status,updated_at);

CREATE TABLE IF NOT EXISTS social_knowledge_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  level TEXT,
  known_as_json TEXT NOT NULL DEFAULT '[]',
  address_terms_json TEXT NOT NULL DEFAULT '[]',
  cognition_detail_ids_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_memory_id TEXT,
  source_batch_id TEXT,
  source_start_ordinal INTEGER,
  source_end_ordinal INTEGER,
  manual INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_edit_ordinal INTEGER,
  auto_locked INTEGER NOT NULL DEFAULT 0 CHECK(auto_locked IN (0,1)),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_social_knowledge_chat_pair ON social_knowledge_events(chat_id,holder,subject,active,source_end_ordinal,created_at);

CREATE TABLE IF NOT EXISTS promises (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  promise_key TEXT NOT NULL,
  promisor TEXT NOT NULL,
  promisee TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_for TEXT,
  status_reason TEXT,
  source_memory_id TEXT,
  source_batch_id TEXT,
  retention_scope TEXT NOT NULL DEFAULT 'arc',
  updated_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_edit_ordinal INTEGER,
  auto_locked INTEGER NOT NULL DEFAULT 0 CHECK(auto_locked IN (0,1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  ended_at_turn INTEGER,
  recency_until_turn INTEGER,
  UNIQUE(chat_id, promise_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promise_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  promise_id TEXT NOT NULL,
  promise_key TEXT NOT NULL,
  promisor TEXT NOT NULL,
  promisee TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_for TEXT,
  status_reason TEXT,
  source_memory_id TEXT,
  source_batch_id TEXT,
  source_ordinal INTEGER,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  user_authored INTEGER NOT NULL DEFAULT 0 CHECK(user_authored IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  ended_at_turn INTEGER,
  recency_until_turn INTEGER,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_promise_events_chat_ordinal ON promise_events(chat_id,source_ordinal,created_at);

CREATE TABLE IF NOT EXISTS chat_lineage (
  child_chat_id TEXT PRIMARY KEY,
  parent_chat_id TEXT,
  parent_title TEXT,
  kind TEXT NOT NULL,
  fork_message_id TEXT,
  fork_ordinal INTEGER,
  ordinal_offset INTEGER NOT NULL DEFAULT 0,
  detection TEXT NOT NULL,
  status TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  reverted_at INTEGER,
  acknowledged_at INTEGER,
  FOREIGN KEY(child_chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_lineage_items (
  child_chat_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  child_item_id TEXT NOT NULL,
  parent_item_id TEXT NOT NULL,
  PRIMARY KEY(child_chat_id,item_kind,child_item_id),
  FOREIGN KEY(child_chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  existing_json TEXT NOT NULL,
  incoming_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  incoming_json TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  model_decision_json TEXT,
  model_error TEXT,
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_json TEXT,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_items_chat_status ON reconciliation_items(chat_id,status,created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  leased_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS extraction_batches (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  job_id TEXT UNIQUE,
  generation_id TEXT NOT NULL DEFAULT 'active',
  kind TEXT NOT NULL DEFAULT 'extract',
  source_message_ids_json TEXT NOT NULL,
  source_fingerprint_json TEXT NOT NULL,
  start_ordinal INTEGER NOT NULL,
  end_ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','pending_review','applied','failed','stale','superseded')),
  draft_json TEXT,
  final_json TEXT,
  audit_patch_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_extraction_batches_chat_range ON extraction_batches(chat_id,generation_id,start_ordinal,end_ordinal);

CREATE TABLE IF NOT EXISTS atom_relations (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  source_detail_id TEXT NOT NULL,
  target_detail_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('continuation_of','consequence_of','resolution_of','fulfillment_of','contradiction_of','callback_to','same_referent')),
  confidence REAL NOT NULL CHECK(confidence>0 AND confidence<=1),
  evidence_json TEXT NOT NULL,
  source_batch_id TEXT,
  source_start_ordinal INTEGER,
  source_end_ordinal INTEGER,
  created_revision INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(source_detail_id) REFERENCES memory_details(id) ON DELETE CASCADE,
  FOREIGN KEY(target_detail_id) REFERENCES memory_details(id) ON DELETE CASCADE,
  FOREIGN KEY(source_batch_id) REFERENCES extraction_batches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_atom_relations_source ON atom_relations(chat_id,source_detail_id,active);
CREATE INDEX IF NOT EXISTS idx_atom_relations_target ON atom_relations(chat_id,target_detail_id,active);
CREATE INDEX IF NOT EXISTS idx_atom_relations_source_active_confidence ON atom_relations(chat_id,source_detail_id,confidence DESC,id) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_atom_relations_target_active_confidence ON atom_relations(chat_id,target_detail_id,confidence DESC,id) WHERE active=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_atom_relations_active_pair ON atom_relations(chat_id,source_detail_id,target_detail_id) WHERE active=1;
CREATE TRIGGER IF NOT EXISTS atom_relation_delete_access AFTER DELETE ON atom_relations BEGIN
  DELETE FROM item_access WHERE chat_id=old.chat_id AND item_kind='atom_relation' AND item_id=old.id;
END;
CREATE TRIGGER IF NOT EXISTS atom_relation_deactivate_access AFTER UPDATE OF active ON atom_relations WHEN new.active=0 BEGIN
  UPDATE item_access SET active=0 WHERE chat_id=new.chat_id AND item_kind='atom_relation' AND item_id=new.id;
END;

CREATE TABLE IF NOT EXISTS regeneration_runs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('episode','canonical_suffix')),
  batch_id TEXT NOT NULL,
  shadow_chat_id TEXT,
  job_id TEXT,
  source_fingerprint_json TEXT NOT NULL,
  post_extraction_review INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','ready','applied','discarded','failed','stale')),
  preview_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(batch_id) REFERENCES extraction_batches(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS story_spine_nodes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  generation_id TEXT NOT NULL DEFAULT 'active',
  level TEXT NOT NULL CHECK(level IN ('segment','arc','overview')),
  scope TEXT NOT NULL CHECK(scope IN ('shared','perspective')),
  holder TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  beats_json TEXT NOT NULL DEFAULT '[]',
  active_transitions_json TEXT NOT NULL DEFAULT '[]',
  start_ordinal INTEGER NOT NULL,
  end_ordinal INTEGER NOT NULL,
  source_token_count INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','stale','superseded')),
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  CHECK((scope='shared' AND holder IS NULL) OR (scope='perspective' AND holder IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_story_spine_nodes_chat_range ON story_spine_nodes(chat_id,generation_id,status,level,start_ordinal,end_ordinal);

CREATE TABLE IF NOT EXISTS story_spine_support (
  node_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(node_id,item_id),
  FOREIGN KEY(node_id) REFERENCES story_spine_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS story_spine_sources (
  node_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(node_id,source_node_id),
  FOREIGN KEY(node_id) REFERENCES story_spine_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(source_node_id) REFERENCES story_spine_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_regeneration_runs_chat ON regeneration_runs(chat_id,status,updated_at);

CREATE TABLE IF NOT EXISTS relationship_baselines (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  qualitative_json TEXT NOT NULL DEFAULT '{}',
  known_axes_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  source_quote TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  setup_fingerprint TEXT,
  projection_axes_json TEXT,
  initial_summary TEXT,
  user_managed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id,from_entity,to_entity),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_memory_id TEXT,
  source_detail_id TEXT,
  source_job_id TEXT,
  source_batch_id TEXT,
  source_start_ordinal INTEGER,
  source_end_ordinal INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(source_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
  FOREIGN KEY(source_detail_id) REFERENCES memory_details(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_relationship_events_pair ON relationship_events(chat_id,from_entity,to_entity,active,source_start_ordinal,created_at);
CREATE TABLE IF NOT EXISTS relationship_projections (
  chat_id TEXT NOT NULL,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  axes_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  active_tensions_json TEXT NOT NULL DEFAULT '[]',
  basis_event_ids_json TEXT NOT NULL DEFAULT '[]',
  overrides_json TEXT NOT NULL DEFAULT '{}',
  event_cursor_json TEXT NOT NULL DEFAULT '{"revision":-1,"eventIds":[]}',
  projection_origin TEXT NOT NULL DEFAULT 'llm',
  stale INTEGER NOT NULL DEFAULT 0,
  updated_revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  user_edit_ordinal INTEGER,
  auto_locked INTEGER NOT NULL DEFAULT 0 CHECK(auto_locked IN (0,1)),
  PRIMARY KEY(chat_id,from_entity,to_entity),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS relationship_projection_queue (
  chat_id TEXT NOT NULL,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'incremental',
  PRIMARY KEY(chat_id,from_entity,to_entity),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS physical_intimacy_milestones (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  participant_a TEXT NOT NULL,
  participant_b TEXT NOT NULL,
  milestone_key TEXT NOT NULL,
  act TEXT NOT NULL,
  custom_label TEXT,
  initiator TEXT,
  interaction_context TEXT NOT NULL DEFAULT 'ambiguous',
  circumstance TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_quote TEXT,
  source_memory_id TEXT,
  source_batch_id TEXT,
  source_start_ordinal INTEGER,
  auto_inject INTEGER NOT NULL DEFAULT 1,
  manual_override INTEGER NOT NULL DEFAULT 0,
  deleted_by_user INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id,participant_a,participant_b,milestone_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(source_memory_id) REFERENCES memories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_intimacy_milestones_pair ON physical_intimacy_milestones(chat_id,participant_a,participant_b,source_start_ordinal,created_at);
CREATE TABLE IF NOT EXISTS entity_scene_presence (
  chat_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  scene_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,entity_name,scene_key),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS entity_prominence (
  chat_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'incidental',
  scene_count INTEGER NOT NULL DEFAULT 0,
  durable_links INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,entity_name),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, leased_until, created_at);

CREATE TABLE IF NOT EXISTS recall_logs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  query TEXT NOT NULL,
  perspective TEXT,
  selected_json TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS memory_vector_map (
  rowid INTEGER PRIMARY KEY,
  memory_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embedding_blocks (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  message_ids_json TEXT NOT NULL,
  start_ordinal INTEGER NOT NULL,
  end_ordinal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  model TEXT NOT NULL DEFAULT 'voyage-context-4',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chat_id, content_hash, model),
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embedding_blocks_pending ON embedding_blocks(status, created_at);

CREATE TABLE IF NOT EXISTS embedding_items (
  rowid INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('memory','memory_detail','transcript_chunk','story_segment','story_arc','story_overview')),
  source_id TEXT NOT NULL,
  block_id TEXT,
  source_json TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(block_id) REFERENCES embedding_blocks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embedding_items_chat_kind ON embedding_items(chat_id, kind);

CREATE TABLE IF NOT EXISTS embedding_failures (
  item_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_passages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
  canonical_hash TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
  quote TEXT NOT NULL, speaker TEXT, epistemic TEXT NOT NULL, access_json TEXT NOT NULL,
  source_batch_id TEXT, active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(chat_id,message_id) REFERENCES messages(chat_id,message_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_source_passages_message ON source_passages(chat_id,message_id,active);
CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(chat_id UNINDEXED,message_id UNINDEXED,body);
-- The source index shares the owning message rowid; edits/deletes never scan FTS metadata.
CREATE TRIGGER IF NOT EXISTS source_fts_insert AFTER INSERT ON messages WHEN new.memory_excluded=0 BEGIN
  INSERT INTO source_fts(rowid,chat_id,message_id,body) VALUES(new.rowid,new.chat_id,new.message_id,COALESCE(new.canonical_content,new.content,''));
END;
CREATE TRIGGER IF NOT EXISTS source_fts_update AFTER UPDATE OF canonical_content,content,memory_excluded,chat_id,message_id ON messages
WHEN old.memory_excluded IS NOT new.memory_excluded OR (new.memory_excluded=0 AND (
  COALESCE(old.canonical_content,old.content,'') IS NOT COALESCE(new.canonical_content,new.content,'')
  OR old.chat_id IS NOT new.chat_id OR old.message_id IS NOT new.message_id)) BEGIN
  DELETE FROM source_fts WHERE rowid=old.rowid;
  INSERT INTO source_fts(rowid,chat_id,message_id,body) SELECT new.rowid,new.chat_id,new.message_id,COALESCE(new.canonical_content,new.content,'') WHERE new.memory_excluded=0;
END;
CREATE TRIGGER IF NOT EXISTS source_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM source_fts WHERE rowid=old.rowid;
END;

CREATE TABLE IF NOT EXISTS translation_cache (
  model TEXT NOT NULL DEFAULT '',
  cache_key TEXT PRIMARY KEY,
  server_instance_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translated TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_translation_cache_lru ON translation_cache(used_at);
CREATE INDEX IF NOT EXISTS idx_translation_cache_item ON translation_cache(chat_id,item_id);
CREATE TABLE IF NOT EXISTS quiz_items (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('choice4','ox')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  quote TEXT,
  memory_id TEXT NOT NULL,
  memory_fingerprint TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  chosen_index INTEGER,
  correct INTEGER,
  retry_after INTEGER,
  retired_at INTEGER,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quiz_items_open ON quiz_items(chat_id, answered_at, retired_at, created_at, position);
-- Keep reference tombstones after memory/chat deletion: an address is never reassigned.
CREATE TABLE IF NOT EXISTS memory_references (
  chat_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  PRIMARY KEY(chat_id, ref),
  UNIQUE(chat_id, memory_id)
);
CREATE TABLE IF NOT EXISTS quiz_state (
  chat_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  last_batch_scene_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
`;

export interface DatabaseHandle {
  db: RcmDatabase;
  vectorEnabled: boolean;
}

export function openDatabase(path: string): DatabaseHandle {
  const db = new Database(path);
  db.function("is_initial_calibration_memory", { deterministic: true }, (memory_key: unknown) => Number(isInitialCalibrationMemory({ memory_key })));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const hasSchemaLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get());
  let version = 0;
  if (hasSchemaLedger) {
    version = Number((db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null }).version ?? 0);
    if (version === 46) {
      db.transaction(() => {
        db.exec("ALTER TABLE translation_cache ADD COLUMN model TEXT NOT NULL DEFAULT ''");
        migrateTranslationKeys(db);
        db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(47,?)").run(Date.now());
      })();
    }
    if (![46, 47, 48, 49, 50, 51, DATABASE_SCHEMA_VERSION].includes(version)) {
      db.close();
      throw Object.assign(new Error(`RCM pre-release schema ${version} cannot be upgraded in place. Archive the database and start with a fresh schema.`), { code: "PRE_RELEASE_SCHEMA_RESET_REQUIRED" });
    }
  }
  db.transaction(() => {
    if (hasSchemaLedger && version < 52 && !(db.pragma("table_info(entities)") as Array<{ name: string }>).some(column => column.name === "color")) {
      db.exec(`ALTER TABLE entities ADD COLUMN ${entityColorColumn}`);
    }
    if (hasSchemaLedger && version < 51) {
      for (const [table, columns] of Object.entries({ promises: ["pinned", "ended_at_turn", "recency_until_turn"], promise_events: ["ended_at_turn", "recency_until_turn"] })) {
        const existing = new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(column => column.name));
        for (const column of columns) if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column === "pinned" ? "INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1))" : "INTEGER"}`);
      }
    }
    if (hasSchemaLedger && !(db.pragma("table_info(messages)") as Array<{ name: string }>).some(column => column.name === "memory_excluded")) {
      db.exec("ALTER TABLE messages ADD COLUMN memory_excluded INTEGER NOT NULL DEFAULT 0 CHECK(memory_excluded IN (0,1))");
      db.exec("DROP TRIGGER IF EXISTS source_fts_insert; DROP TRIGGER IF EXISTS source_fts_update");
    }
    if (hasSchemaLedger && version < 50) {
      db.exec("DROP TRIGGER IF EXISTS source_fts_insert; DROP TRIGGER IF EXISTS source_fts_update; DROP TRIGGER IF EXISTS source_fts_delete");
    }
    db.exec(schema);
    if (hasSchemaLedger && version < 50) {
      // Older FTS rowids were independent and changed on every source edit.
      // Rebuild this derived index once, atomically with the trigger upgrade.
      db.exec(`DELETE FROM source_fts;
        INSERT INTO source_fts(rowid,chat_id,message_id,body)
        SELECT rowid,chat_id,message_id,COALESCE(canonical_content,content,'') FROM messages WHERE memory_excluded=0`);
    }
    if (hasSchemaLedger && version < 48) db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(48,?)").run(Date.now());
    if (hasSchemaLedger && version < 49) db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(49,?)").run(Date.now());
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)").run(DATABASE_SCHEMA_VERSION, Date.now());
  })();
  if (!hasSchemaLedger) {
    db.prepare("INSERT OR IGNORE INTO server_meta(key,value) VALUES('instance_id',?)").run(randomUUID());
  }
  migrateTranslationKeys(db);
  let currentVectorEnabled = false;
  try {
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS embedding_vectors_v4_chat USING vec0(embedding float[1024], chat_id TEXT PARTITION KEY)");
    currentVectorEnabled = true;
  } catch (error) {
    console.warn("[RCM] sqlite-vec unavailable; continuing with FTS and lexical search", error);
  }
  return { db, vectorEnabled: currentVectorEnabled };
}

export const now = (): number => Date.now();

export function purgeExpiredRevisionBodies(db: RcmDatabase): number {
  return db.prepare(`
    UPDATE message_revisions
    SET content = NULL
    WHERE purge_after IS NOT NULL AND purge_after <= ? AND content IS NOT NULL
  `).run(now()).changes;
}
