import React, { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import styled from "styled-components";
import { useParams } from "react-router-dom";

const Container = styled.div`
    padding: 20px;
    display: flex;
    height: 100vh;
    width: 100%;
    margin: auto;
    flex-wrap: wrap;
    background-color: grey;
`;

const StyledVideo = styled.video`
    height: 40%;
    width: 50%;
`;

const Video = ({ peer }) => {
    const ref = useRef();

    useEffect(() => {
        peer.on("stream", stream => {
            ref.current.srcObject = stream;
        });
    }, [peer]);

    return <StyledVideo playsInline autoPlay ref={ref} />;
};

const StyledSelect = styled.select`
    padding: 10px;
    margin: 20px;
    font-size: 16px;
    border: 2px solid #ddd;
    border-radius: 5px;
    background-color: #fff;
    color: #333;
    outline: none;

    &:focus {
        border-color: #aaa;
    }

    option {
        padding: 10px;
        background-color: #fff;
        color: #333;
    }
`;

const videoConstraints = {
    height: window.innerHeight / 2,
    width: window.innerWidth / 2
};

const RoomGet = ({ socket }) => {
    const [peers, setPeers] = useState([]);
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState("");
    const socketRef = useRef();
    const userVideo = useRef();
    const peersRef = useRef([]);
    const params = useParams();
    const roomID = params.roomID;

    useEffect(() => {
        socketRef.current = socket;

        navigator.mediaDevices.enumerateDevices().then(deviceInfos => {
            const videoDevices = deviceInfos.filter(device => device.kind === 'videoinput');
            setDevices(videoDevices);
            if (videoDevices.length > 0) {
                setSelectedDeviceId(videoDevices[0].deviceId);
            }
        });

        socketRef.current.on("user left", id => {
            const peerObj = peersRef.current.find(p => p.peerID === id);
            if (peerObj) {
                peerObj.peer.destroy();
                peersRef.current = peersRef.current.filter(p => p.peerID !== id);
                setPeers(peers => peers.filter(p => p.peerID !== id));
            }
        });

    }, [socket]);

    useEffect(() => {
        if (selectedDeviceId) {
            navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: selectedDeviceId } },
                audio: true
            }).then(stream => {
                userVideo.current.srcObject = stream;
                socketRef.current.emit("join room", roomID);
                socketRef.current.on("all users", users => {
                    const peers = [];
                    users.forEach(userID => {
                        const peer = createPeer(userID, socketRef.current.id, stream);
                        peersRef.current.push({
                            peerID: userID,
                            peer,
                        });
                        peers.push({ peerID: userID, peer });
                    });
                    setPeers(peers);
                });

                socketRef.current.on("user joined", payload => {
                    const peer = addPeer(payload.signal, payload.callerID, stream);
                    peersRef.current.push({
                        peerID: payload.callerID,
                        peer,
                    });
                    setPeers(users => [...users, { peerID: payload.callerID, peer }]);
                });

                socketRef.current.on("receiving returned signal", payload => {
                    const item = peersRef.current.find(p => p.peerID === payload.id);
                    if (item) {
                        item.peer.signal(payload.signal);
                    }
                });

                // Handle stream updates when the user changes the camera source
                socketRef.current.on("stream updated", newStream => {
                    userVideo.current.srcObject = newStream;
                });

            }).catch(error => {
                console.error('Error accessing media devices.', error);
            });
        }
    }, [selectedDeviceId, roomID]);

    useEffect(() => {
        if (selectedDeviceId) {
            updateStream();
        }
    }, [selectedDeviceId]);

    const updateStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: selectedDeviceId } },
                audio: true
            });

            userVideo.current.srcObject = stream;

            // Update stream for each peer
            peersRef.current.forEach(({ peer }) => {
                peer.replaceTrack(
                    peer.streams[0].getVideoTracks()[0],
                    stream.getVideoTracks()[0],
                    peer.streams[0]
                );
            });

            // Notify peers about the stream update
            socketRef.current.emit("stream updated", stream);
        } catch (error) {
            console.error("Error updating media stream.", error);
        }
    };

    function createPeer(userToSignal, callerID, stream) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream,
        });

        peer.on("signal", signal => {
            socketRef.current.emit("sending signal", { userToSignal, callerID, signal });
        });

        return peer;
    }

    function addPeer(incomingSignal, callerID, stream) {
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream,
        });

        peer.on("signal", signal => {
            socketRef.current.emit("returning signal", { signal, callerID });
        });

        peer.signal(incomingSignal);

        return peer;
    }

    return (
        <Container>
            <StyledSelect onChange={(e) => setSelectedDeviceId(e.target.value)} value={selectedDeviceId}>
                {devices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${device.deviceId}`}
                    </option>
                ))}
            </StyledSelect>
            <StyledVideo muted ref={userVideo} autoPlay playsInline />
            {peers.map(({ peerID, peer }) => (
                <Video key={peerID} peer={peer} />
            ))}
        </Container>
    );
};

export default RoomGet;
