import {ChatBackupSettingsSchema, type ChatBackupSettings} from "@rcm/shared";
import type {PluginSettings} from "./types.js";
import {serverScopeKey} from "./settings.js";

export function exportChatSettings(settings:PluginSettings,id:string,characterId:string):ChatBackupSettings {
  const scope=serverScopeKey(settings,id);
  return ChatBackupSettingsSchema.parse(Object.fromEntries(Object.entries({
    characterEnabled:settings.characterEnabled[characterId]??true,
    enabled:settings.chatEnabled[id],catchUpPending:settings.chatCatchUpPending[id],
    profile:settings.profiles[id],
    narrationViewpoint:settings.narrationViewpoint[id],
    lineageSettingsFrom:settings.lineageSettingsFrom[id],
    includeUserMessages:settings.includeUserMessages[id],extractionGroupTurns:settings.extractionGroupTurns[id],
    upcomingOccasions:settings.upcomingOccasions[id],
    pairProgress:settings.pairProgress[id],
    memoryOnlyInjection:settings.memoryOnlyInjection[id],
    memoryLanguage:settings.memoryLanguages[id],backfillApproved:scope?settings.backfillApproved[scope]:undefined,
    memoryBudget:settings.memoryBudgets[id],storyOverviewBackup:settings.storyOverviewBackups[id],
  }).filter(([, value]) => value !== undefined)));
}

export function restoreChatSettings(settings:PluginSettings,id:string,input:unknown,characterId:string):void {
  if (input === undefined) return;
  const value=ChatBackupSettingsSchema.parse(input);
  if (!Object.keys(value).length) return;
  const put=<T>(record:Record<string,T>,entry:T|undefined)=>{if(entry===undefined)delete record[id];else record[id]=structuredClone(entry);};
  settings.characterEnabled[characterId]=value.characterEnabled??true;
  put(settings.chatEnabled,value.enabled);put(settings.chatCatchUpPending,value.catchUpPending);
  put(settings.profiles,value.profile);
  put(settings.narrationViewpoint,value.narrationViewpoint);
  put(settings.lineageSettingsFrom,value.lineageSettingsFrom);
  const scope=serverScopeKey(settings,id);
  if(scope){
    if(value.backfillApproved===undefined)delete settings.backfillApproved[scope];else settings.backfillApproved[scope]=value.backfillApproved;
  }
  put(settings.includeUserMessages,value.includeUserMessages);put(settings.extractionGroupTurns,value.extractionGroupTurns);
  put(settings.upcomingOccasions,value.upcomingOccasions);
  put(settings.pairProgress,value.pairProgress);
  put(settings.memoryOnlyInjection,value.memoryOnlyInjection);
  put(settings.memoryLanguages,value.memoryLanguage);
  put(settings.memoryBudgets,value.memoryBudget);put(settings.storyOverviewBackups,value.storyOverviewBackup);
}
