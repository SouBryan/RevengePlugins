import {
	AuthError,
	findStreamKey,
	RateLimitError,
	sendHeartbeat,
	sendHeartbeatNative,
} from "../api";
import type { Quest, QuestTaskType } from "../types";

const HEARTBEAT_INTERVAL_MS = 25_000; // 25s between heartbeats

function getProgress(quest: Quest, taskType: QuestTaskType): number {
	const progress = quest.user_status?.progress?.[taskType];
	if (progress?.value != null) return progress.value;
	return quest.user_status?.stream_progress_seconds ?? 0;
}

function needsDesktopSpoof(taskType: QuestTaskType): boolean {
	return taskType === "PLAY_ON_DESKTOP" || taskType === "STREAM_ON_DESKTOP";
}

export function startHeartbeatTask(
	quest: Quest,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let currentProgress = getProgress(quest, taskType);
	const streamKey = findStreamKey();
	const spoofDesktop = needsDesktopSpoof(taskType);

	async function beat() {
		if (cancelled) return;

		try {
			const doHeartbeat = spoofDesktop ? sendHeartbeat : sendHeartbeatNative;
			const resp = await doHeartbeat(quest.id, streamKey, false);

			const taskProgress = resp?.progress?.[taskType];
			if (taskProgress?.value != null) {
				currentProgress = taskProgress.value;
			}

			if (currentProgress >= target) {
				// Send terminal heartbeat
				try {
					await doHeartbeat(quest.id, streamKey, true);
				} catch {
					// ignore terminal errors
				}
				onComplete();
				return;
			}
		} catch (e) {
			if (e instanceof RateLimitError) {
				timeoutId = setTimeout(beat, e.retryAfter * 1000);
				return;
			}
			if (e instanceof AuthError) {
				console.error(`[CompleteDiscordQuest] Auth failed, stopping heartbeat task`);
				cancelled = true;
				return;
			}
			console.error(`[CompleteDiscordQuest] Heartbeat error for ${quest.id}:`, e);
		}

		if (!cancelled) {
			timeoutId = setTimeout(beat, HEARTBEAT_INTERVAL_MS);
		}
	}

	// If already complete, resolve immediately
	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	// Start first beat immediately
	beat();

	return () => {
		cancelled = true;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};
}
