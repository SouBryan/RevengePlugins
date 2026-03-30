import type { ActiveTask, Quest, QuestTaskType } from "../types";
import { startHeartbeatTask } from "./heartbeatTask";
import { startVideoTask } from "./videoTask";

const activeTasks = new Map<string, ActiveTask>();

function getMainTask(quest: Quest): { type: QuestTaskType; target: number } | null {
	const tasks = quest.config?.task_config?.tasks;
	if (!tasks) return null;

	const priority: QuestTaskType[] = [
		"WATCH_VIDEO",
		"WATCH_VIDEO_ON_MOBILE",
		"PLAY_ON_DESKTOP",
		"STREAM_ON_DESKTOP",
		"PLAY_ACTIVITY",
	];

	for (const type of priority) {
		if (tasks[type]) {
			return { type, target: tasks[type].target };
		}
	}

	return null;
}

export function startTask(quest: Quest, onComplete?: () => void): boolean {
	if (activeTasks.has(quest.id)) return false;

	const task = getMainTask(quest);
	if (!task) return false;

	const questName = quest.config?.messages?.quest_name ?? quest.id;

	const handleComplete = () => {
		activeTasks.delete(quest.id);
		console.log(`[CompleteDiscordQuest] Quest complete: ${questName}`);
		onComplete?.();
	};

	let cleanup: () => void;

	if (task.type === "WATCH_VIDEO" || task.type === "WATCH_VIDEO_ON_MOBILE") {
		cleanup = startVideoTask(quest, task.type, task.target, handleComplete);
	} else {
		cleanup = startHeartbeatTask(quest, task.type, task.target, handleComplete);
	}

	activeTasks.set(quest.id, {
		questId: quest.id,
		questName,
		taskType: task.type,
		cleanup,
	});

	console.log(
		`[CompleteDiscordQuest] Started ${task.type} for: ${questName} (target: ${task.target}s)`,
	);
	return true;
}

export function stopTask(questId: string): void {
	const task = activeTasks.get(questId);
	if (task) {
		task.cleanup();
		activeTasks.delete(questId);
	}
}

export function stopAllTasks(): void {
	for (const [, task] of activeTasks) {
		task.cleanup();
	}
	activeTasks.clear();
}

export function isTaskActive(questId: string): boolean {
	return activeTasks.has(questId);
}

export function getActiveTasks(): ActiveTask[] {
	return Array.from(activeTasks.values());
}

export { getMainTask };
