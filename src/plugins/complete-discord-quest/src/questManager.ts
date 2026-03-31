import { showToast } from "@vendetta/ui/toasts";

import { enrollQuest, getQuests } from "./api";
import { vstorage } from "./settings";
import { FluxDispatcher, QuestsStore } from "./stores";
import { getMainTask, isTaskActive, startTask, stopAllTasks } from "./tasks";
import type { Quest, QuestTaskType } from "./types";

// ---- Helpers for camelCase/snake_case dual access on raw QuestsStore data ----
function prop(obj: any, ...keys: string[]): any {
	if (!obj) return undefined;
	for (const k of keys) {
		if (obj[k] !== undefined) return obj[k];
	}
	return undefined;
}

function getQuestConfig(q: any): any {
	return q?.config ?? null;
}

function getQuestUserStatus(q: any): any {
	return q?.userStatus ?? q?.user_status ?? null;
}

function getExpiresAt(q: any): string | null {
	const cfg = getQuestConfig(q);
	return prop(cfg, "expiresAt", "expires_at") ?? null;
}

function getEnrolledAt(q: any): string | null {
	const us = getQuestUserStatus(q);
	return prop(us, "enrolledAt", "enrolled_at") ?? null;
}

function getCompletedAt(q: any): string | null {
	const us = getQuestUserStatus(q);
	return prop(us, "completedAt", "completed_at") ?? null;
}

function getQuestName(q: any): string {
	const cfg = getQuestConfig(q);
	const msgs = cfg?.messages;
	return prop(msgs, "questName", "quest_name") ?? q?.id ?? "unknown";
}

function getTasksMap(q: any): Record<string, any> | null {
	const cfg = getQuestConfig(q);
	const tc = prop(cfg, "taskConfig", "taskConfigV2", "task_config");
	return tc?.tasks ?? null;
}

function getRewards(q: any): any[] {
	const cfg = getQuestConfig(q);
	const rc = prop(cfg, "rewardsConfig", "rewards_config");
	return rc?.rewards ?? [];
}

// ---- Quest state checks ----

function isQuestExpired(q: any): boolean {
	const expires = getExpiresAt(q);
	if (!expires) return false;
	return new Date(expires).getTime() <= Date.now();
}

function isQuestCompleted(q: any): boolean {
	return !!getCompletedAt(q);
}

function isQuestEnrolled(q: any): boolean {
	return !!getEnrolledAt(q);
}

function isTaskTypeEnabled(taskType: QuestTaskType): boolean {
	switch (taskType) {
		case "WATCH_VIDEO":
		case "WATCH_VIDEO_ON_MOBILE":
			return vstorage.farmVideos;
		case "PLAY_ON_DESKTOP":
			return vstorage.farmPlayOnDesktop;
		case "STREAM_ON_DESKTOP":
			return vstorage.farmStreamOnDesktop;
		case "PLAY_ACTIVITY":
			return vstorage.farmPlayActivity;
		default:
			return false;
	}
}

function matchesRewardFilter(q: any): boolean {
	const anyFilterActive = vstorage.filterRewardCodes
		|| vstorage.filterInGame
		|| vstorage.filterCollectibles
		|| vstorage.filterVirtualCurrency
		|| vstorage.filterFractionalPremium;

	if (!anyFilterActive) return true;

	const rewards = getRewards(q);
	if (!rewards?.length) return false;

	return rewards.some((r: any) => {
		switch (r.type) {
			case 1: return vstorage.filterRewardCodes;
			case 2: return vstorage.filterInGame;
			case 3: return vstorage.filterCollectibles;
			case 4: return vstorage.filterVirtualCurrency;
			case 5: return vstorage.filterFractionalPremium;
			default: return false;
		}
	});
}

function isQuestEligible(q: any): boolean {
	if (isQuestExpired(q)) return false;
	if (isQuestCompleted(q)) return false;

	const task = getMainTask(q);
	if (!task) return false;
	if (!isTaskTypeEnabled(task.type)) return false;
	if (!matchesRewardFilter(q)) return false;

	return true;
}

// ---- Fetch quests from QuestsStore (handles Map or Object) ----

function fetchQuestsFromStore(): any[] {
	try {
		const storeQuests = QuestsStore?.quests;
		if (!storeQuests) return [];

		// Handle Map (Vencord-style: QuestsStore.quests is a Map)
		if (typeof storeQuests.values === "function" && typeof storeQuests.size === "number") {
			const arr = [...storeQuests.values()];
			if (arr.length > 0) return arr;
		}

		// Handle plain object
		if (typeof storeQuests === "object") {
			const arr = Object.values(storeQuests);
			if (arr.length > 0) return arr;
		}
	} catch (e) {
		console.error("[CompleteDiscordQuest] Error reading QuestsStore:", e);
	}
	return [];
}

async function fetchQuests(): Promise<any[]> {
	// QuestsStore has ALL quests (enrolled or not) from the Gateway
	const storeQuests = fetchQuestsFromStore();
	if (storeQuests.length > 0) {
		console.log(`[CompleteDiscordQuest] Got ${storeQuests.length} quest(s) from QuestsStore`);
		return storeQuests;
	}

	// Fallback: REST API (only returns enrolled quests)
	console.log("[CompleteDiscordQuest] QuestsStore empty, falling back to REST");
	const resp = await getQuests();
	return resp.quests ?? [];
}

// ---- Enrollment ----

async function enrollPendingQuests(quests: any[]): Promise<any[]> {
	const toEnroll = quests.filter((q) => !isQuestEnrolled(q) && !isQuestExpired(q) && !isQuestCompleted(q));

	if (toEnroll.length > 0) {
		console.log(`[CompleteDiscordQuest] Attempting to enroll ${toEnroll.length} quest(s)`);
	}

	for (const quest of toEnroll) {
		const name = getQuestName(quest);
		const task = getMainTask(quest);
		console.log(`[CompleteDiscordQuest] Enrolling: ${name} (id=${quest.id}, type=${task?.type ?? "unknown"}, enrolledAt=${getEnrolledAt(quest) ?? "null"})`);
		try {
			await enrollQuest(quest.id);
			console.log(`[CompleteDiscordQuest] Enrolled OK: ${name}`);
			showToast(`Quest enrolled: ${name}`);
		} catch (e: any) {
			console.error(`[CompleteDiscordQuest] Failed to enroll ${name}: ${e?.message ?? e}`);
			showToast(`Failed to enroll: ${name}`);
		}
	}

	// Re-read from QuestsStore after enrollment (it updates via Flux)
	await new Promise(r => setTimeout(r, 1000));
	return fetchQuestsFromStore().length > 0 ? fetchQuestsFromStore() : quests;
}

export async function startFarming(): Promise<void> {
	try {
		let quests = await fetchQuests();
		console.log(`[CompleteDiscordQuest] Fetched ${quests.length} quest(s)`);

		for (const q of quests) {
			const name = getQuestName(q);
			const task = getMainTask(q);
			const us = getQuestUserStatus(q);
			console.log(`[CompleteDiscordQuest] Quest: ${name} | id=${q.id} | type=${task?.type ?? "none"} | enrolled=${!!getEnrolledAt(q)} | completed=${!!getCompletedAt(q)} | expired=${isQuestExpired(q)} | userStatus keys=${us ? Object.keys(us).join(",") : "null"}`);
		}

		// Enroll quests that haven't been accepted yet
		quests = await enrollPendingQuests(quests);

		// For farming, accept quests even if enrollment API failed —
		// the quest might already be enrolled (QuestsStore reflects real status)
		const eligible = quests.filter(
			(q: any) => !isQuestCompleted(q) && !isQuestExpired(q) && isQuestEligible(q) && !isTaskActive(q.id),
		);

		if (eligible.length === 0) {
			console.log("[CompleteDiscordQuest] No eligible quests to farm");
			showToast("No eligible quests found");
			return;
		}

		console.log(`[CompleteDiscordQuest] Starting ${eligible.length} quest(s)`);

		for (const quest of eligible) {
			const name = getQuestName(quest);
			const started = startTask(quest, () => {
				showToast(`Quest completed: ${name} ✓`);
			});
			if (started) {
				showToast(`Farming: ${name}`);
			}
		}
	} catch (e) {
		console.error("[CompleteDiscordQuest] startFarming error:", e);
		showToast("Farming error - check logs");
	}
}

export function stopFarming(): void {
	stopAllTasks();
	console.log("[CompleteDiscordQuest] All farming stopped");
}

// ---- Debug: dump QuestsStore raw data ----
export function debugDumpQuests(): string {
	// Check QuestsStore type
	const raw = QuestsStore?.quests;
	const storeType = raw instanceof Map ? "Map" : (Array.isArray(raw) ? "Array" : typeof raw);

	const quests = fetchQuestsFromStore();
	if (quests.length === 0) return `QuestsStore is empty (type=${storeType}, raw keys=${raw ? Object.keys(raw).slice(0, 5).join(",") : "null"})`;

	const lines: string[] = [`Total: ${quests.length} quest(s) [store type=${storeType}]\n`];
	for (const q of quests) {
		const name = getQuestName(q);
		const task = getMainTask(q);
		const enrolled = getEnrolledAt(q);
		const completed = getCompletedAt(q);
		const expired = isQuestExpired(q);
		const topKeys = Object.keys(q).join(",");
		const cfgKeys = q?.config ? Object.keys(q.config).join(",") : "null";
		const usKeys = getQuestUserStatus(q) ? Object.keys(getQuestUserStatus(q)).join(",") : "null";
		lines.push(`${name}\n  id=${q.id}\n  type=${task?.type ?? "?"} target=${task?.target ?? "?"}\n  enrolled=${enrolled ?? "no"} completed=${completed ?? "no"} expired=${expired}\n  topKeys=[${topKeys}]\n  cfgKeys=[${cfgKeys}]\n  usKeys=[${usKeys}]`);
	}
	return lines.join("\n\n");
}
