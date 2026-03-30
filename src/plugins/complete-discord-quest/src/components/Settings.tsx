import { React } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { vstorage } from "../settings";

const { FormSection, FormRow, FormSwitchRow } = Forms;

export default function Settings() {
	useProxy(vstorage);

	return (
		<>
			<FormSection title="Automation">
				<FormSwitchRow
					label="Auto-accept quests"
					subLabel="Automatically accept and start completing new quests"
					value={vstorage.autoAccept}
					onValueChange={(v: boolean) => (vstorage.autoAccept = v)}
				/>
			</FormSection>

			<FormSection title="Quest Types">
				<FormSwitchRow
					label="Watch Video"
					subLabel="WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE"
					value={vstorage.farmVideos}
					onValueChange={(v: boolean) => (vstorage.farmVideos = v)}
				/>
				<FormSwitchRow
					label="Play on Desktop"
					subLabel="PLAY_ON_DESKTOP (spoofed from mobile)"
					value={vstorage.farmPlayOnDesktop}
					onValueChange={(v: boolean) => (vstorage.farmPlayOnDesktop = v)}
				/>
				<FormSwitchRow
					label="Stream on Desktop"
					subLabel="STREAM_ON_DESKTOP (spoofed from mobile)"
					value={vstorage.farmStreamOnDesktop}
					onValueChange={(v: boolean) => (vstorage.farmStreamOnDesktop = v)}
				/>
				<FormSwitchRow
					label="Play Activity"
					subLabel="PLAY_ACTIVITY"
					value={vstorage.farmPlayActivity}
					onValueChange={(v: boolean) => (vstorage.farmPlayActivity = v)}
				/>
			</FormSection>

			<FormSection title="Reward Filters (only farm quests with these rewards)">
				<FormSwitchRow
					label="Reward Codes"
					value={vstorage.filterRewardCodes}
					onValueChange={(v: boolean) => (vstorage.filterRewardCodes = v)}
				/>
				<FormSwitchRow
					label="In-Game Rewards"
					value={vstorage.filterInGame}
					onValueChange={(v: boolean) => (vstorage.filterInGame = v)}
				/>
				<FormSwitchRow
					label="Collectibles"
					value={vstorage.filterCollectibles}
					onValueChange={(v: boolean) => (vstorage.filterCollectibles = v)}
				/>
				<FormSwitchRow
					label="Virtual Currency"
					value={vstorage.filterVirtualCurrency}
					onValueChange={(v: boolean) => (vstorage.filterVirtualCurrency = v)}
				/>
				<FormSwitchRow
					label="Fractional Premium"
					value={vstorage.filterFractionalPremium}
					onValueChange={(v: boolean) => (vstorage.filterFractionalPremium = v)}
				/>
			</FormSection>
		</>
	);
}
