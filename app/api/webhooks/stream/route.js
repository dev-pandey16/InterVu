import { db } from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request) {
    const body = await request.json();
    const eventType = body.type;

    if (
        eventType !== "call.transcription_ready" &&
        eventType !== "call.recording_ready"
    ) {
        return Response.json({ ok: true });
    };

    const callCid = body.call_cid ?? "";
    const streamCallId = callCid.includes(":") ? callCid.split(":")[1] : callCid;
    // console.log(
    //     `[stream-webhook] call_cid: ${callCid} → streamCallId: ${streamCallId}`
    // );


    if (!streamCallId) {
        return Response.json({ ok: true });
    }

    try {
        console.log(`[stream-webhook] Looking up booking in DB...`);
        const booking = await db.booking.findUnique({
            where: { streamCallId },
            include: {
                interviewer: {
                    select: { id: true, clerkUserId: true, name: true, categories: true },
                },
                interviewee: {
                    select: { id: true, clerkUserId: true, name: true },
                },
                feedback: { select: { id: true } },
            },
        });

        if (!booking) {
            // console.log(
            //     `[stream-webhook] No booking found for streamCallId: ${streamCallId}`
            // );
            return Response.json({ ok: true });
        }

        // Recording Ready----- --------
        if (eventType === "call.recording_ready") {
            const recordingUrl = body.call_recording?.url;

            if (!recordingUrl) {
                return Response.json({ ok: true });
            }

            await db.booking.update({
                where: { id: booking.id },
                data: { recordingUrl },
            });

            return Response.json({ ok: true });
        }


        // Transcription Ready--------__------------

        if (eventType === "call.transcription_ready") {
            if (booking.feedback) {
                return Response.json({ ok: true });
            }

            const transcriptionUrl = body.call_transcription?.url;
            if (!transcriptionUrl) {
                return Response.json({ ok: true });
            }

            // 1. Download JSONL from Stream CDN
            const transcriptRes = await fetch(transcriptionUrl);
            const transcriptText = await transcriptRes.text();

            //2. Parse JSONL into readable conversation
            const lines = transcriptText
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return null;
                    }
                })
                .filter((entry) => entry?.type === "speech");

            if (lines.length === 0) {
                return Response.json({ ok: true });
            }

            // Map clerkUserId to display name
            const speakerMap = {
                [booking.interviewer.clerkUserId]:
                    booking.interviewer.name ?? "Interviewer",
                [booking.interviewee.clerkUserId]:
                    booking.interviewee.name ?? "Interviewee",
            };

            const transcript = lines
                .map((l) => `${speakerMap[l.speaker_id] ?? l.speaker_id}: ${l.text}`)
                .join("\n");


            // 3. Generate feedback via Gemini
            // console.log(
            //     `[stream-webhook] Sending transcript to Gemini (gemini-3-flash-preview)...`
            // );
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: "gemini-3-flash-preview",
            });
            const categories =
                booking.interviewer.categories?.join(", ") ?? "General";

            const prompt = `You are an expert technical interviewer evaluating a mock interview.

Interview categories: ${categories}
Interviewer: ${booking.interviewer.name}
Candidate: ${booking.interviewee.name}

TRANSCRIPT:
${transcript}

Analyze the candidate's performance. Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation:
{
  "summary": "2-3 sentence overall summary of the session",
  "technical": "Assessment of technical knowledge and accuracy",
  "communication": "Assessment of clarity, structure, and communication style",
  "problemSolving": "Assessment of problem-solving approach and thought process",
  "recommendation": "HIRE / CONSIDER / NO_HIRE with a one-sentence reason",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "overallRating": "POOR or AVERAGE or GOOD or EXCELLENT"
}`;

            const result = await model.generateContent(prompt);
            const raw = result.response
                .text()
                .trim()
                .replace(/^```json|^```|```$/gm, "")
                .trim();


            const feedbackData = JSON.parse(raw);

            // 4. Write to DB — upsert handles concurrent webhook retries cleanly (no P2002)
            // console.log(`[stream-webhook] Writing feedback to DB...`);
            await db.$transaction([
                db.feedback.upsert({
                    where: { bookingId: booking.id },
                    create: {
                        bookingId: booking.id,
                        summary: feedbackData.summary,
                        technical: feedbackData.technical,
                        communication: feedbackData.communication,
                        problemSolving: feedbackData.problemSolving,
                        recommendation: feedbackData.recommendation,
                        strengths: feedbackData.strengths,
                        improvements: feedbackData.improvements,
                        overallRating: feedbackData.overallRating,
                    },
                    update: {}, // already exists — no-op, keep the original
                }),
                db.booking.update({
                    where: { id: booking.id },
                    data: { status: "COMPLETED" },
                }),
            ]);


            // Credit transaction is outside the main transaction so we can check first
            const earnExists = await db.creditTransaction.findFirst({
                where: { bookingId: booking.id, type: "BOOKING_EARNING" },
            });

            if (!earnExists) {
                await db.creditTransaction.create({
                    data: {
                        userId: booking.interviewer.id,
                        amount: booking.creditsCharged,
                        type: "BOOKING_EARNING",
                        bookingId: booking.id,
                    },
                });
                // console.log(
                //   `[stream-webhook] Credit earning transaction created (+${booking.creditsCharged} credits for interviewer)`
                // );
            } else {
                // console.log(
                //   `[stream-webhook] Earning transaction already exists, skipping`
                // );
            }
        }

        return Response.json({ ok: true });
    } catch (error) {
        console.error(`[stream-webhook] ✗ ${eventType} error:`, error);
        // Always 200 — non-2xx triggers Stream retries, making the race worse
        return Response.json({ ok: true });
    }

}