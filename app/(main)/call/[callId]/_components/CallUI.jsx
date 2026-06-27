"use client";

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CallControls, CallingState, SpeakerLayout, StreamTheme, useCall, useCallStateHooks } from '@stream-io/video-react-sdk';
import { Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { SP } from 'next/dist/shared/lib/utils';
import React, { useCallback, useEffect, useState } from 'react'
import { Channel, Chat, MessageList, MessageComposer, useCreateChatClient, Window } from 'stream-chat-react';
import AIQuestionsPanel from './AIQuestionsPanel';

const CallUI = ({
    callId,
    isInterviewer,
    booking,
    onLeave,
    apiKey,
    token,
    currentUser,
}) => {

    const { useCallCallingState } = useCallStateHooks();
    const call = useCall();
    const callingState = useCallCallingState();

    const chatClient = useCreateChatClient({
        apiKey,
        tokenOrProvider: token,
        userData: {
            id: currentUser.id,
            name: currentUser.name,
            image: currentUser.imageUrl,
        },
    });

    const handleLeave = useCallback(async () => {
        try {
            if (call) {
                const isRecording = call.state?.recording;
                if (isRecording) {
                    await call.stopRecording().catch(() => { });
                }
                await call.leave().catch(() => { });
            }
        } finally {
            onLeave();
        }
    }, [call, onLeave]);

    const [chatChannel, setChatChannel] = useState(null);

    useEffect(() => {
        if (!chatClient) return;

        const channel = chatClient.channel("messaging", callId, {
            name: "Interview Chat",
            members: [
                booking.interviewer.clerkUserId,
                booking.interviewee.clerkUserId,
            ],
        });

        channel
            .watch()
            .then(() => setChatChannel(channel))
            .catch(console.error);

        return () => {
            channel.stopWatching().catch(() => { });
        };
    }, [chatClient, callId, booking]);

    if (callingState === CallingState.LEFT) {
        return (
            <div className="min-h-screen bg-[#0a0a0b] flex flex-col items-center justify-center gap-3">
                <p className="text-stone-400 text-sm ">Leaving Call...</p>
            </div>
        );
    }




    return (
        <div className="h-[92vh] bg-[#0a0a0b] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 shrink-0">
                <div className="flex items-center gap-2 ">
                    <Badge
                        variant='outline'
                        className="border-white/10 text-stone-400 text-xs"
                    >
                        {booking.interviewer.name}
                        <span className="text-stone-600 mx-1.5">×</span>
                        {booking.interviewee.name}
                    </Badge>

                    {isInterviewer && (
                        <Badge
                            variant='outline'
                            className="border-amber-400/20 bg-amber-400/5 text-amber-400 text-xs"
                        >
                            Interviewer
                        </Badge>
                    )}
                </div>
            </div>

            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-w-0">
                    <StreamTheme>
                        <SpeakerLayout participantsBarPosition="bottom" />
                        <CallControls onLeave={handleLeave} />
                    </StreamTheme>
                </div>

                <div className="w-85 shrink-0 flex flex-col border-l border-white/8 bg-[#0a0a0b] min-h-0">
                    <Tabs defaultValue="chat" className = 'flex flex-col flex-1 min-h-0'>
                        <TabsList variant='line' className="w-full shrink-0">
                            <TabsTrigger value="chat" className={"w-1/2"}>
                                <MessageSquare size={13} />
                                Chat
                            </TabsTrigger>
                            {true && (<TabsTrigger value="questions" className={"w-1/2"}>
                                <Sparkles size={13} />
                                AI Questions
                            </TabsTrigger>)}
                        </TabsList>
                        <TabsContent value="chat" className="flex-1 min-h-0 overflow-hidden">
                            {chatClient && chatChannel ? (
                                <Chat client={chatClient} theme='str-chat__theme-dark'>
                                    <Channel channel={chatChannel}>
                                        <Window>
                                            <MessageList />
                                            <MessageComposer focus />
                                        </Window>
                                    </Channel>
                                </Chat>
                            ):(
                                <div className = "flex items-center justify-center h-full">
                                    <Loader2 size={18} className ="text-stone-600 animate-spin" />
                                </div>
                            )}
                        </TabsContent>
                        <TabsContent value="questions" className="flex-1 min-h-0 overflow-hidden">
                            <AIQuestionsPanel categories={booking.categories} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    )
}

export default CallUI