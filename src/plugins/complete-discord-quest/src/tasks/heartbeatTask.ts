import {
	AuthError,
	findStreamKeyForQuest,
	RateLimitError,
	sendHeartbeat,
	sendHeartbeatNative,
} from "../api";
import type { QuestTaskType } from "../types";
import { updateTaskProgress } from "./index";

const HEARTBEAT_INTERVAL_MS = 30_000; // Match the working script's cadence

function getProgress(quest: any, taskType: QuestTaskType): number {
	const us = quest?.userStatus ?? quest?.user_status;
	if (!us) return 0;

	const progress = us?.progress?.[taskType];
	if (progress?.value != null) return progress.value;
	return us?.streamProgressSeconds ?? us?.stream_progress_seconds ?? 0;
}

function prop(obj: any, ...keys: string[]): any {
	if (!obj) return undefined;
	for (const key of keys) {
		if (obj[key] !== undefined) return obj[key];
	}
	return undefined;
}

async function startManualHeartbeatLoop(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
	streamKey: string,
): Promise<() => void> {
	let cancelled = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let currentProgress = getProgress(quest, taskType);
	const doHeartbeat = taskType === "PLAY_ACTIVITY" ? sendHeartbeatNative : sendHeartbeat;

	async function beat(terminal = false) {
		if (cancelled) return;

		try {
			const resp = await doHeartbeat(quest.id, streamKey, terminal);
			const taskProgress = resp?.progress?.[taskType];
			if (taskProgress?.value != null) {
				currentProgress = taskProgress.value;
			}

			updateTaskProgress(quest.id, currentProgress, "running");
			console.log(
				`[CompleteDiscordQuest] ${taskType} heartbeat OK for ${quest.id}: ${currentProgress}/${target}s`,
			);

			if (!terminal && currentProgress >= target) {
				try {
					await doHeartbeat(quest.id, streamKey, true);
				} catch {
					// ignore terminal heartbeat errors
				}
				onComplete();
				return;
			}
		} catch (e) {
			if (e instanceof RateLimitError) {
				updateTaskProgress(
					quest.id,
					currentProgress,
					"rate-limited",
					`Rate limited ${e.retryAfter}s`,
				);
				timeoutId = setTimeout(() => beat(false), e.retryAfter * 1000);
				return;
			}
			if (e instanceof AuthError) {
				updateTaskProgress(quest.id, currentProgress, "error", e.message);
				console.error(`[CompleteDiscordQuest] Auth error for ${quest.id}: ${e.message}`);
				timeoutId = setTimeout(() => beat(false), 30_000);
				return;
			}
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", errMsg);
			console.error(`[CompleteDiscordQuest] ${taskType} heartbeat error for ${quest.id}:`, e);
		}

		if (!cancelled && !terminal) {
			timeoutId = setTimeout(() => beat(false), HEARTBEAT_INTERVAL_MS);
		}
	}

	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	console.log(`[CompleteDiscordQuest] Starting ${taskType} loop for ${quest.id} with stream_key=${streamKey}`);
	beat(false);

	return () => {
		cancelled = true;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};
}
export function startHeartbeatTask(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): () => void {
	const currentProgress = getProgress(quest, taskType);
	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	let cleanup: (() => void) | null = null;
	void findStreamKeyForQuest(quest.id).then((streamKey) => {
		return startManualHeartbeatLoop(quest, taskType, target, onComplete, streamKey);
	}).then((fn) => {
		cleanup = fn;
	});
	return () => cleanup?.();
}
