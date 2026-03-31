import {
	AuthError,
	findStreamKey,
	RateLimitError,
	sendHeartbeat,
	sendHeartbeatNative,
} from "../api";
import type { QuestTaskType } from "../types";
import { updateTaskProgress } from "./index";

const HEARTBEAT_INTERVAL_MS = 25_000; // 25s between heartbeats

function getProgress(quest: any, taskType: QuestTaskType): number {
	const us = quest?.userStatus ?? quest?.user_status;
	if (!us) return 0;

	const progress = us?.progress?.[taskType];
	if (progress?.value != null) return progress.value;
	return us?.streamProgressSeconds ?? us?.stream_progress_seconds ?? 0;
}

function needsDesktopSpoof(taskType: QuestTaskType): boolean {
	return taskType === "PLAY_ON_DESKTOP" || taskType === "STREAM_ON_DESKTOP";
}

export function startHeartbeatTask(
	quest: any,
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

			updateTaskProgress(quest.id, currentProgress, "running");
			console.log(
				`[CompleteDiscordQuest] Heartbeat OK for ${quest.id}: ${currentProgress}/${target}s`,
			);

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
				updateTaskProgress(
					quest.id,
					currentProgress,
					"rate-limited",
					`Rate limited ${e.retryAfter}s`,
				);
				timeoutId = setTimeout(beat, e.retryAfter * 1000);
				return;
			}
			if (e instanceof AuthError) {
				updateTaskProgress(quest.id, currentProgress, "error", e.message);
				console.error(`[CompleteDiscordQuest] Auth error for ${quest.id}: ${e.message}`);
				// Retry after 30s instead of giving up — might be transient
				timeoutId = setTimeout(beat, 30_000);
				return;
			}
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", errMsg);
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
