const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require("cors")
const { v4: uuidv4 } = require('uuid');
const app = express(); // Initialize the app variable using express

app.use(cors())

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

app.get('/', function (req, res) {
  res.send('Hello from the server!')
})

const users = {};

const socketToRoom = {};

const socketID_to_Users_Map = {}
const roomID_to_Code_Map = {}
const roomID_to_PeerConnections = {}

async function getUsersinRoom(roomId, io) {
  const socketList = await io.in(roomId).allSockets()
  const userslist = []
  socketList.forEach((each) => {
    (each in socketID_to_Users_Map) && userslist.push(socketID_to_Users_Map[each].username)
  })

  return userslist
}

async function updateUserslistAndCodeMap(io, socket, roomId) {
  socket.in(roomId).emit("member left", { username: socketID_to_Users_Map[socket.id].username })

  // update the user list
  delete socketID_to_Users_Map[socket.id]
  const userslist = await getUsersinRoom(roomId, io)
  socket.in(roomId).emit("updating client list", { userslist: userslist })

  userslist.length === 0 && delete roomID_to_Code_Map[roomId]
  userslist.length === 0 && delete roomID_to_PeerConnections[roomId]
}

// Whenever someone connects this gets executed
io.on('connection', function (socket) {
  console.log('A user connected', socket.id)

  socket.on("when a user joins", async ({ roomId, username }) => {
    console.log("username: ", username)
    socketID_to_Users_Map[socket.id] = { username }
    socket.join(roomId)

    const userslist = await getUsersinRoom(roomId, io)

    // for other users, updating the client list
    socket.in(roomId).emit("updating client list", { userslist: userslist })

    // for this user, updating the client list
    io.to(socket.id).emit("updating client list", { userslist: userslist })

    // send the latest code changes to this user when joined to existing room
    if (roomId in roomID_to_Code_Map) {
      io.to(socket.id).emit("on language change", { languageUsed: roomID_to_Code_Map[roomId].languageUsed })
      io.to(socket.id).emit("on code change", { code: roomID_to_Code_Map[roomId].code })
    }

    // alerting other users in room that new user joined
    socket.in(roomId).emit("new member joined", {
      username
    })
  })


  socket.on("send_message", ({ message, roomId, username }) => {
    const messageId = uuidv4(); // Generate unique ID for each message
    socket.to(roomId).emit("receive_message", { message, messageId, user: username });
  });




  // for other users in room to view the changes
  socket.on("update language", ({ roomId, languageUsed }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]['languageUsed'] = languageUsed
    } else {
      roomID_to_Code_Map[roomId] = { languageUsed }
    }
  })

  // for user editing the code to reflect on his/her screen
  socket.on("syncing the language", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on language change", { languageUsed: roomID_to_Code_Map[roomId].languageUsed })
    }
  })

  // for other users in room to view the changes
  socket.on("update code", ({ roomId, code }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]['code'] = code
    } else {
      roomID_to_Code_Map[roomId] = { code }
    }
  })

  // for user editing the code to reflect on his
  // for user editing the code to reflect on his/her screen
  socket.on("syncing the code", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on code change", { code: roomID_to_Code_Map[roomId].code })
    }
  })

  socket.on("leave room", ({ roomId }) => {
    socket.leave(roomId)
    updateUserslistAndCodeMap(io, socket, roomId)
  })

  socket.on("disconnecting", (reason) => {
    socket.rooms.forEach(eachRoom => {
      if (eachRoom in roomID_to_Code_Map) {
        updateUserslistAndCodeMap(io, socket, eachRoom)
      }
    })
  })


  socket.on('canvasImage', (data) => {
    console.log("jiji",data.roomId);
    socket.to(data.roomId).emit('canvasImage', data);
  });

  // Whenever someone disconnects this piece of code executed


  // **Video conferencing logic**
  socket.on("join room", roomID => {
    if (users[roomID]) {
      const length = users[roomID].length;
      if (length === 4) {
        socket.emit("room full");
        return;
      }
      users[roomID].push(socket.id);
    } else {
      users[roomID] = [socket.id];
    }
    socketToRoom[socket.id] = roomID;
    const usersInThisRoom = users[roomID].filter(id => id !== socket.id);

    socket.emit("all users", usersInThisRoom);
  });

  socket.on("sending signal", payload => {
    io.to(payload.userToSignal).emit('user joined', { signal: payload.signal, callerID: payload.callerID });
  });

  socket.on("returning signal", payload => {
    io.to(payload.callerID).emit('receiving returned signal', { signal: payload.signal, id: socket.id });
  });

  socket.on('disconnect', () => {
    const roomID = socketToRoom[socket.id];
    let room = users[roomID];
    if (room) {
      room = room.filter(id => id !== socket.id);
      users[roomID] = room;
    }
  });
});

// you can store your port number in a dotenv file, fetch it from there and store it in PORT
// we have hard coded the port number here just for convenience
const PORT = process.env.PORT || 5000

server.listen(PORT, function () {
  console.log(`listening on port : ${PORT}`)
})
