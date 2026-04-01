import type { ActiveTask, QuestTaskType } from "../types";
import { startHeartbeatTask, teardownDesktopTaskRuntime } from "./heartbeatTask";
import { startVideoTask } from "./videoTask";

const activeTasks = new Map<string, ActiveTask>();

// Helper: access camelCase or snake_case property
function prop(obj: any, ...keys: string[]): any {
	if (!obj) return undefined;
	for (const k of keys) {
		if (obj[k] !== undefined) return obj[k];
	}
	return undefined;
}

function getMainTask(quest: any): { type: QuestTaskType; target: number } | null {
	const cfg = quest?.config;
	if (!cfg) return null;

	const tc = prop(cfg, "taskConfig", "taskConfigV2", "task_config");
	const tasks = tc?.tasks;
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

function getQuestName(quest: any): string {
	const msgs = quest?.config?.messages;
	return prop(msgs, "questName", "quest_name") ?? quest?.id ?? "unknown";
}

export function startTask(quest: any, onComplete?: () => void): boolean {
	if (activeTasks.has(quest.id)) return false;

	const task = getMainTask(quest);
	if (!task) return false;

	const questName = getQuestName(quest);

	const activeTask: ActiveTask = {
		questId: quest.id,
		questName,
		taskType: task.type,
		target: task.target,
		progress: 0,
		status: "running",
		cleanup: () => {},
	};

	// Add to map early so heartbeat callbacks can update it
	activeTasks.set(quest.id, activeTask);

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

	activeTask.cleanup = cleanup;

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

export function teardownTaskRuntime(): void {
	teardownDesktopTaskRuntime();
}

export function isTaskActive(questId: string): boolean {
	return activeTasks.has(questId);
}

export function getActiveTasks(): ActiveTask[] {
	return Array.from(activeTasks.values());
}

export function updateTaskProgress(
	questId: string,
	progress: number,
	status: "running" | "error" | "rate-limited",
	lastError?: string,
): void {
	const task = activeTasks.get(questId);
	if (task) {
		task.progress = progress;
		task.status = status;
		task.lastError = lastError;
	}
}

export { getMainTask };
