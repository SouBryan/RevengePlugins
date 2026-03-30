import Settings from "./components/Settings";
import { startFarming, stopFarming } from "./questManager";
import { initDefaults, vstorage } from "./settings";
import { FluxDispatcher } from "./stores";

let fluxUnsubs: (() => void)[] = [];

export function onLoad() {
	initDefaults();

	const onQuestsUpdate = () => {
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

	FluxDispatcher.subscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate);
	FluxDispatcher.subscribe("QUEST_ENROLLED", onQuestsUpdate);
	FluxDispatcher.subscribe("CONNECTION_OPEN", onReady);
	FluxDispatcher.subscribe("CONNECTION_CLOSED", onConnectionClosed);

	fluxUnsubs.push(
		() => FluxDispatcher.unsubscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate),
		() => FluxDispatcher.unsubscribe("QUEST_ENROLLED", onQuestsUpdate),
		() => FluxDispatcher.unsubscribe("CONNECTION_OPEN", onReady),
		() => FluxDispatcher.unsubscribe("CONNECTION_CLOSED", onConnectionClosed),
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
