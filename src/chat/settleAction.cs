using System;

// "Rhino Race settle" (docs/streamer-bot-action.md): the game calls it through DoAction once per redemption.
// Both calls work only on rewards created in Streamer.bot.
public class CPHInline
{
	public bool Execute()
	{
		CPH.TryGetArg("rewardId", out string rewardId);
		CPH.TryGetArg("redemptionId", out string redemptionId);
		CPH.TryGetArg("reward", out string reward);
		CPH.TryGetArg("outcome", out string outcome);
		bool done;
		if (outcome == "fulfilled") done = CPH.TwitchRedemptionFulfill(rewardId, redemptionId);
		else if (outcome == "refunded") done = CPH.TwitchRedemptionCancel(rewardId, redemptionId);
		else
		{
			CPH.LogWarn($"Rhino Race settle: unknown outcome '{outcome}' for {reward} {redemptionId}");
			return false;
		}
		if (done) CPH.LogInfo($"Rhino Race settle: {reward} {redemptionId} {outcome}");
		else CPH.LogWarn($"Rhino Race settle: Twitch refused {outcome} for {reward} {redemptionId} (reward not created in Streamer.bot?)");
		return done;
	}
}
