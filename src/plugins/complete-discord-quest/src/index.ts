import { storage } from "@vendetta/plugin";

import Settings from "./components/Settings";
import { vstorage, initDefaults } from "./settings";
import { startFarming, stopFarming } from "./questManager";
import { FluxDispatcher } from "./stores";

let fluxUnsubs: (() => void)[] = [];

export function onLoad() {
	initDefaults();

	const onQuestsUpdate = () => {
		if (vstorage.autoAccept) {
			startFarming();
		}
	};

	FluxDispatcher.subscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate);
	FluxDispatcher.subscribe("QUEST_ENROLLED", onQuestsUpdate);

	fluxUnsubs.push(
		() => FluxDispatcher.unsubscribe("QUESTS_FETCH_SUCCESS", onQuestsUpdate),
		() => FluxDispatcher.unsubscribe("QUEST_ENROLLED", onQuestsUpdate),
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
