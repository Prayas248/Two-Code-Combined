import React, { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import styled from "styled-components";
import { useParams } from "react-router-dom";

// Styles
const Container = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100%;
  background-color: grey;
`;

const Sidebar = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 20%;
  padding: 20px;
  background-color: #333;
`;

const StyledSelect = styled.select`
  padding: 10px;
  margin: 10px 0;
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

const VideoContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  flex-grow: 1;
  padding: 20px;
`;

const StyledVideo = styled.video`
  width: 100%;
  height: 100%;
  border-radius: 8px;
  border: 2px solid #444;
`;

// Video component to render the video stream
const Video = ({ peer }) => {
  const ref = useRef();

  useEffect(() => {
    peer.on("stream", (stream) => {
      console.log("Received stream from peer:", peer, stream);
      ref.current.srcObject = stream;
    });

    peer.on("error", (error) => {
      console.error("Peer error:", error);
    });
  }, [peer]);

  return <StyledVideo playsInline autoPlay ref={ref} />;
};

const RoomGet = ({ socket }) => {
  const [peers, setPeers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState("");
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState("");
  const socketRef = useRef();
  const userVideo = useRef();
  const peersRef = useRef([]);
  const params = useParams();
  const roomID = params.roomID;

  useEffect(() => {
    socketRef.current = socket;

    // Enumerate media devices
    navigator.mediaDevices.enumerateDevices().then((deviceInfos) => {
      const videoDevices = deviceInfos.filter((device) => device.kind === "videoinput");
      const audioInputDevices = deviceInfos.filter((device) => device.kind === "audioinput");
      const audioOutputDevices = deviceInfos.filter((device) => device.kind === "audiooutput");

      setDevices(videoDevices);
      setAudioInputDevices(audioInputDevices);
      setAudioOutputDevices(audioOutputDevices);

      if (videoDevices.length > 0) setSelectedVideoDeviceId(videoDevices[0].deviceId);
      if (audioInputDevices.length > 0) setSelectedAudioInputDeviceId(audioInputDevices[0].deviceId);
      if (audioOutputDevices.length > 0) setSelectedAudioOutputDeviceId(audioOutputDevices[0].deviceId);
    });

    socketRef.current.on("user left", (id) => {
      const peerObj = peersRef.current.find((p) => p.peerID === id);
      if (peerObj) {
        peerObj.peer.destroy();
        peersRef.current = peersRef.current.filter((p) => p.peerID !== id);
        setPeers((peers) => peers.filter((p) => p.peerID !== id));
      }
    });
  }, [socket]);
  
  useEffect(()=>{
    console.log(peers);
  },[peers])

  useEffect(() => {
    if (selectedVideoDeviceId && selectedAudioInputDeviceId) {
      navigator.mediaDevices
        .getUserMedia({
          video: { deviceId: { exact: selectedVideoDeviceId } },
          audio: { deviceId: { exact: selectedAudioInputDeviceId } },
        })
        .then((stream) => {
          console.log("User media stream obtained:", stream);
          userVideo.current.srcObject = stream;
          socketRef.current.emit("join room", roomID);

          socketRef.current.on("all users", (users) => {
            const peers = [];
            users.forEach((userID) => {
              const peer = createPeer(userID, socketRef.current.id, stream);
              peersRef.current.push({
                peerID: userID,
                peer,
              });
              peers.push({ peerID: userID, peer });
            });
            setPeers(peers);
          });

          socketRef.current.on("user joined", (payload) => {
            const peer = addPeer(payload.signal, payload.callerID, stream);
            peersRef.current.push({
              peerID: payload.callerID,
              peer,
            });
            setPeers((users) => [...users, { peerID: payload.callerID, peer }]);
          });

          socketRef.current.on("receiving returned signal", (payload) => {
            const item = peersRef.current.find((p) => p.peerID === payload.id);
            if (item) {
              item.peer.signal(payload.signal);
            }
          });
        })
        .catch((error) => {
          console.error("Error accessing media devices.", error);
        });
    }
  }, [selectedVideoDeviceId, selectedAudioInputDeviceId, roomID]);

  function createPeer(userToSignal, callerID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("sending signal", { userToSignal, callerID, signal });
    });

    peer.on("stream", (stream) => {
      console.log(`New stream from peer ${userToSignal}:`, stream);
    });

    peer.on("error", (error) => {
      console.error("Peer error (initiator):", error);
    });

    return peer;
  }

  function addPeer(incomingSignal, callerID, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("returning signal", { signal, callerID });
    });

    peer.on("stream", (stream) => {
      console.log(`New stream from peer ${callerID}:`, stream);
    });

    peer.on("error", (error) => {
      console.error("Peer error (non-initiator):", error);
    });

    peer.signal(incomingSignal);

    return peer;
  }

  const handleAudioOutputChange = (e) => {
    const selectedOutput = e.target.value;
    setSelectedAudioOutputDeviceId(selectedOutput);
    // Change audio output device for the user
    if (userVideo.current) {
      userVideo.current.setSinkId(selectedOutput).catch((err) => console.error("Error setting audio output device:", err));
    }
  };

  return (
    <Container>
      <Sidebar>
        <StyledSelect onChange={(e) => setSelectedVideoDeviceId(e.target.value)} value={selectedVideoDeviceId}>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera ${device.deviceId}`}
            </option>
          ))}
        </StyledSelect>
        <StyledSelect onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)} value={selectedAudioInputDeviceId}>
          {audioInputDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId}`}
            </option>
          ))}
        </StyledSelect>
        <StyledSelect onChange={handleAudioOutputChange} value={selectedAudioOutputDeviceId}>
          {audioOutputDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Speaker ${device.deviceId}`}
            </option>
          ))}
        </StyledSelect>
      </Sidebar>
      <VideoContainer>
        <StyledVideo muted ref={userVideo} autoPlay playsInline />
        {peers.map(({ peerID, peer }) => (
          <Video key={peerID} peer={peer} />
        ))}
      </VideoContainer>
    </Container>
  );
};

export default RoomGet;
