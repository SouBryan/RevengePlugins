import { showToast } from "@vendetta/ui/toasts";

import { enrollQuest, getQuests } from "./api";
import { vstorage } from "./settings";
import { QuestsStore } from "./stores";
import { getMainTask, isTaskActive, startTask, stopAllTasks } from "./tasks";
import type { Quest, QuestTaskType } from "./types";

function isQuestExpired(quest: Quest): boolean {
	const expires = quest.config?.expires_at;
	if (!expires) return false;
	return new Date(expires).getTime() <= Date.now();
}

function isQuestCompleted(quest: Quest): boolean {
	return !!quest.user_status?.completed_at;
}

function isQuestEnrolled(quest: Quest): boolean {
	return !!quest.user_status?.enrolled_at;
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

function matchesRewardFilter(quest: Quest): boolean {
	const anyFilterActive = vstorage.filterRewardCodes
		|| vstorage.filterInGame
		|| vstorage.filterCollectibles
		|| vstorage.filterVirtualCurrency
		|| vstorage.filterFractionalPremium;

	// If no reward filters active, allow all
	if (!anyFilterActive) return true;

	const rewards = quest.config?.rewards_config?.rewards;
	if (!rewards?.length) return false;

	return rewards.some((r) => {
		switch (r.type) {
			case 1:
				return vstorage.filterRewardCodes;
			case 2:
				return vstorage.filterInGame;
			case 3:
				return vstorage.filterCollectibles;
			case 4:
				return vstorage.filterVirtualCurrency;
			case 5:
				return vstorage.filterFractionalPremium;
			default:
				return false;
		}
	});
}

function isQuestEligible(quest: Quest): boolean {
	if (isQuestExpired(quest)) return false;
	if (isQuestCompleted(quest)) return false;

	const task = getMainTask(quest);
	if (!task) return false;
	if (!isTaskTypeEnabled(task.type)) return false;
	if (!matchesRewardFilter(quest)) return false;

	return true;
}

async function fetchQuests(): Promise<Quest[]> {
	// Try QuestsStore first (already loaded in memory)
	try {
		const storeQuests = QuestsStore?.quests;
		if (storeQuests && typeof storeQuests === "object") {
			const entries = Object.values(storeQuests) as any[];
			if (entries.length > 0) {
				return entries.map((q: any) => ({
					id: q.id,
					preview: q.preview,
					config: q.config,
					user_status: q.userStatus ?? q.user_status ?? null,
					targeted_content: q.targetedContent ?? [],
				}));
			}
		}
	} catch {
		// fallback to REST
	}

	// Fallback: REST API
	const resp = await getQuests();
	return resp.quests ?? [];
}

async function enrollPendingQuests(quests: Quest[]): Promise<Quest[]> {
	const toEnroll = quests.filter((q) => !isQuestEnrolled(q) && !isQuestExpired(q) && !isQuestCompleted(q));

	if (toEnroll.length > 0) {
		console.log(`[CompleteDiscordQuest] Attempting to enroll ${toEnroll.length} quest(s)`);
	}

	for (const quest of toEnroll) {
		const name = quest.config?.messages?.quest_name ?? quest.id;
		const task = getMainTask(quest);
		console.log(`[CompleteDiscordQuest] Enrolling: ${name} (id=${quest.id}, type=${task?.type ?? "unknown"}, enrolled_at=${quest.user_status?.enrolled_at ?? "null"})`);
		try {
			const status = await enrollQuest(quest.id);
			if (status?.enrolled_at) {
				quest.user_status = status;
			} else {
				// Some APIs return the full user_status, others return partial
				quest.user_status = {
					...(quest.user_status ?? {}),
					enrolled_at: status?.enrolled_at ?? new Date().toISOString(),
					completed_at: null,
					progress: status?.progress ?? {},
				} as any;
			}
			console.log(`[CompleteDiscordQuest] Enrolled OK: ${name}`);
			showToast(`Quest enrolled: ${name}`);
		} catch (e: any) {
			console.error(`[CompleteDiscordQuest] Failed to enroll ${name}: ${e?.message ?? e}`);
			showToast(`Failed to enroll: ${name}`);
		}
	}

	return quests;
}

export async function startFarming(): Promise<void> {
	try {
		let quests = await fetchQuests();
		console.log(`[CompleteDiscordQuest] Fetched ${quests.length} quest(s)`);

		for (const q of quests) {
			const name = q.config?.messages?.quest_name ?? q.id;
			const task = getMainTask(q);
			console.log(`[CompleteDiscordQuest] Quest: ${name} | id=${q.id} | type=${task?.type ?? "none"} | enrolled=${!!q.user_status?.enrolled_at} | completed=${!!q.user_status?.completed_at} | expired=${isQuestExpired(q)}`);
		}

		// Always try to enroll when manually starting
		quests = await enrollPendingQuests(quests);

		const eligible = quests.filter(
			(q) => isQuestEnrolled(q) && isQuestEligible(q) && !isTaskActive(q.id),
		);

		if (eligible.length === 0) {
			console.log("[CompleteDiscordQuest] No eligible quests to farm");
			showToast("No eligible quests found");
			return;
		}

		console.log(`[CompleteDiscordQuest] Starting ${eligible.length} quest(s)`);

		for (const quest of eligible) {
			const name = quest.config?.messages?.quest_name ?? quest.id;
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
