import Settings from "./components/Settings";
import { ingestQuestEvent, startFarming, stopFarming } from "./questManager";
import { initDefaults, vstorage } from "./settings";
import { FluxDispatcher } from "./stores";

let fluxUnsubs: (() => void)[] = [];

function isQuestRelatedDispatch(payload: any): boolean {
	if (!payload || typeof payload !== "object") return false;
	const type = String(payload.type ?? "").toLowerCase();
	if (type.includes("quest") || type.includes("promotion") || type.includes("outbound")) {
		return true;
	}

	const keys = Object.keys(payload);
	return keys.some((key) => {
		const normalized = key.toLowerCase();
		return normalized.includes("quest") || normalized.includes("promotion");
	});
}

export function onLoad() {
	initDefaults();

	const onQuestsUpdate = (event: any) => {
		ingestQuestEvent("QUESTS_FETCH_SUCCESS", event);
		if (vstorage.autoAccept) {
			startFarming();
		}
	};

	const onQuestEnrolled = (event: any) => {
		ingestQuestEvent("QUEST_ENROLLED", event);
		if (vstorage.autoAccept) {
			startFarming();
		}
	};

	// Re-start farming on reconnect (session resume / fresh login)
	const onReady = () => {
		console.log("[CompleteDiscordQuest] Discord READY, resuming farming");
		if (vstorage.autoAccept) {
			// Small delay to let stores populate
			setTimeout(() => startFarming(), 3000);
		}
	};

	// Stop farming on connection loss
	const onConnectionClosed = () => {
		console.log("[CompleteDiscordQuest] Connection lost, stopping farming");
		stopFarming();
	};

	const fluxInterceptor = (payload: any) => {
		if (isQuestRelatedDispatch(payload)) {
			ingestQuestEvent(String(payload?.type ?? "UNKNOWN_EVENT"), payload);
		}
	};

	FluxDispatcher.subscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate);
	FluxDispatcher.subscribe("QUEST_ENROLLED", onQuestEnrolled);
	FluxDispatcher.subscribe("CONNECTION_OPEN", onReady);
	FluxDispatcher.subscribe("CONNECTION_CLOSED", onConnectionClosed);
	(FluxDispatcher._interceptors ??= []).unshift(fluxInterceptor);

	fluxUnsubs.push(
		() => FluxDispatcher.unsubscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate),
		() => FluxDispatcher.unsubscribe("QUEST_ENROLLED", onQuestEnrolled),
		() => FluxDispatcher.unsubscribe("CONNECTION_OPEN", onReady),
		() => FluxDispatcher.unsubscribe("CONNECTION_CLOSED", onConnectionClosed),
		() => {
			FluxDispatcher._interceptors &&= FluxDispatcher._interceptors.filter(
				(interceptor) => interceptor !== fluxInterceptor,
			);
		},
	);

	if (vstorage.autoAccept) {
		startFarming();
	}
}

export function onUnload() {
	stopFarming();

	for (const unsub of fluxUnsubs) {
		unsub();
	}
	fluxUnsubs = [];
}

export const settings = Settings;
