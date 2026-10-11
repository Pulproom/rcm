import {ChatBackupSettingsSchema, type ChatBackupSettings} from "@rcm/shared";
import type {PluginSettings} from "./types.js";
import {serverScopeKey} from "./settings.js";

export function exportChatSettings(settings:PluginSettings,id:string):ChatBackupSettings {
  const scope=serverScopeKey(settings,id);
  return ChatBackupSettingsSchema.parse({
    enabled:settings.chatEnabled[id]??settings.defaultChatEnabled,catchUpPending:settings.chatCatchUpPending[id],
    profile:settings.profiles[id]??settings.defaultProfile,
    perspectives:settings.perspectives[id],detectedPerspectives:scope?settings.detectedPerspectives[scope]:undefined,
    includeUserMessages:settings.includeUserMessages[id],extractionGroupTurns:settings.extractionGroupTurns[id],
    memoryOnlyInjection:settings.memoryOnlyInjection[id]??false,
    memoryLanguage:settings.memoryLanguages[id],backfillApproved:scope?settings.backfillApproved[scope]:undefined,
    memoryBudget:settings.memoryBudgets[id]??settings.defaultMemoryBudget,storyOverviewBackup:settings.storyOverviewBackups[id],
  });
}

export function restoreChatSettings(settings:PluginSettings,id:string,input:unknown):void {
  const value=ChatBackupSettingsSchema.parse(input);
  const put=<T>(record:Record<string,T>,entry:T|undefined)=>{if(entry===undefined)delete record[id];else record[id]=structuredClone(entry);};
  put(settings.chatEnabled,value.enabled);put(settings.chatCatchUpPending,value.catchUpPending);
  put(settings.profiles,value.profile);
  put(settings.perspectives,value.perspectives);
  const scope=serverScopeKey(settings,id);
  if(scope){
    if(value.detectedPerspectives===undefined)delete settings.detectedPerspectives[scope];else settings.detectedPerspectives[scope]=[...value.detectedPerspectives];
    if(value.backfillApproved===undefined)delete settings.backfillApproved[scope];else settings.backfillApproved[scope]=value.backfillApproved;
  }
  put(settings.includeUserMessages,value.includeUserMessages);put(settings.extractionGroupTurns,value.extractionGroupTurns);
  put(settings.memoryOnlyInjection,value.memoryOnlyInjection);
  put(settings.memoryLanguages,value.memoryLanguage);
  put(settings.memoryBudgets,value.memoryBudget);put(settings.storyOverviewBackups,value.storyOverviewBackup);
}
