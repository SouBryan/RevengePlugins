import { storage } from "@vendetta/plugin";

export const vstorage = storage as {
	// Automation
	autoAccept: boolean;

	// Quest type filters
	farmVideos: boolean;
	farmPlayOnDesktop: boolean;
	farmStreamOnDesktop: boolean;
	farmPlayActivity: boolean;

	// Reward filters
	filterRewardCodes: boolean;
	filterInGame: boolean;
	filterCollectibles: boolean;
	filterVirtualCurrency: boolean;
	filterFractionalPremium: boolean;
};

export function initDefaults() {
	vstorage.autoAccept ??= true;

	vstorage.farmVideos ??= true;
	vstorage.farmPlayOnDesktop ??= true;
	vstorage.farmStreamOnDesktop ??= true;
	vstorage.farmPlayActivity ??= true;

	vstorage.filterRewardCodes ??= false;
	vstorage.filterInGame ??= false;
	vstorage.filterCollectibles ??= false;
	vstorage.filterVirtualCurrency ??= false;
	vstorage.filterFractionalPremium ??= false;
}
