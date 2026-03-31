import { React } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { Button, Forms, General } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { startFarming, stopFarming } from "../questManager";
import { vstorage } from "../settings";
import { getActiveTasks } from "../tasks";

const { ScrollView, Text, View } = General;
const { FormSection, FormRow, FormSwitchRow } = Forms;

function formatProgress(progress: number, target: number): string {
	const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
	const mins = Math.floor(progress / 60);
	const targetMins = Math.floor(target / 60);
	return `${mins}m / ${targetMins}m (${pct}%)`;
}

function taskStatusLabel(t: ReturnType<typeof getActiveTasks>[0]): string {
	const prog = formatProgress(t.progress, t.target);
	if (t.status === "error") return `${t.taskType} — ERROR: ${t.lastError ?? "unknown"}`;
	if (t.status === "rate-limited") return `${t.taskType} — ${prog} ⏳ ${t.lastError ?? "rate limited"}`;
	return `${t.taskType} — ${prog}`;
}

function ActiveTasksStatus() {
	const [tasks, setTasks] = React.useState(getActiveTasks());

	React.useEffect(() => {
		const interval = setInterval(() => setTasks([...getActiveTasks()]), 2000);
		return () => clearInterval(interval);
	}, []);

	if (tasks.length === 0) {
		return (
			<FormSection title="Status">
				<FormRow label="No active quests" subLabel="Tap Start Farming to begin" />
			</FormSection>
		);
	}

	return (
		<FormSection title={`Active Quests (${tasks.length})`}>
			{tasks.map((t) => (
				<FormRow
					key={t.questId}
					label={t.questName}
					subLabel={taskStatusLabel(t)}
				/>
			))}
		</FormSection>
	);
}

export default function Settings() {
	useProxy(vstorage);
	const [farming, setFarming] = React.useState(getActiveTasks().length > 0);

	return (
		<ScrollView>
			<ActiveTasksStatus />

			<FormSection title="Controls">
				<View style={{ flexDirection: "row", padding: 12, gap: 8 }}>
					<Button
						text="Start Farming"
						color={farming ? "grey" : "brand"}
						size="small"
						onPress={() => {
							startFarming();
							setFarming(true);
							showToast("Farming started");
						}}
					/>
					<Button
						text="Stop Farming"
						color={farming ? "red" : "grey"}
						size="small"
						onPress={() => {
							stopFarming();
							setFarming(false);
							showToast("Farming stopped");
						}}
					/>
				</View>
			</FormSection>

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
		</ScrollView>
	);
}
