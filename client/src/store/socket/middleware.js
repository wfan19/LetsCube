import { push } from 'connected-react-router';
import { v4 as uuid } from 'uuid';
import * as Protocol from '../../lib/protocol';
import Socket from './Socket';
import {
  CONNECT_SOCKET,
  DISCONNECT_SOCKET,
  connectionChanged,
  roomJoined,
  connected,
  disconnected,
  loginFailed,
} from './actions';
import {
  FETCH_ROOM,
  DELETE_ROOM,
  JOIN_ROOM,
  LEAVE_ROOM,
  SUBMIT_RESULT,
  REQUEST_SCRAMBLE,
  CHANGE_EVENT,
  SEND_STATUS,
  UPDATE_COMPETING,
  EDIT_ROOM,
  joinRoom,
  roomUpdated,
  leaveRoom,
  userJoined,
  userLeft,
  newAttempt,
  newResult,
  receiveStatus,
  updateAdmin,
  updateCompetingForUser,
} from '../room/actions';
import {
  CREATE_ROOM,
  roomCreated,
  roomUpdated as globalRoomUpdated,
  roomDeleted,
  roomsUpdated,
} from '../rooms/actions';
import { createMessage } from '../messages/actions';
import { SEND_CHAT, receiveChat } from '../chat/actions';
import { userCountUpdated } from '../server/actions';

const socketMiddleware = (store) => {
  // The socket's connection state changed
  const onChange = (isConnected) => {
    store.dispatch(connectionChanged(isConnected));
  };

  const socket = new Socket({
    onChange,
    onConnected: () => {
      store.dispatch(connected());
    },
    onDisconnected: () => {
      store.dispatch(disconnected());
    },
    events: {
      [Protocol.RECONNECT]: () => {
        // eslint-disable-next-line no-console
        console.log('[SOCKET.IO] reconnected!');
        if (store.getState().room.accessCode) {
          store.dispatch(joinRoom(store.getState().room._id, store.getState().room.password));
        }
      },
      [Protocol.ERROR]: (error) => {
        // eslint-disable-next-line no-console
        console.log('[SOCKET.IO]', error);
        if (error.statusCode === 404) {
          store.dispatch(push('/'));
        } else if (error.statusCode === 403 && error.event === Protocol.JOIN_ROOM) {
          // Login failed attempt
          store.dispatch(loginFailed({
            error,
          }));

          store.dispatch(createMessage({
            severity: 'error',
            text: error.message,
          }));
        } else if (error.statusCode >= 400 && error.redirect) {
          store.dispatch(push(error.redirect));
        }
      },
      [Protocol.UPDATE_ROOMS]: (rooms) => {
        store.dispatch(roomsUpdated(rooms));
      },
      [Protocol.UPDATE_ROOM]: (room) => {
        store.dispatch(roomUpdated(room));
      },
      [Protocol.GLOBAL_ROOM_UPDATED]: (room) => {
        store.dispatch(globalRoomUpdated(room));
      },
      [Protocol.ROOM_CREATED]: (room) => {
        store.dispatch(roomCreated(room));
      },
      [Protocol.ROOM_DELETED]: (room) => {
        store.dispatch(roomDeleted(room));
        if (room === store.getState().room._id) {
          store.dispatch(leaveRoom());
          store.dispatch(push('/'));
        }
      },
      [Protocol.UPDATE_ADMIN]: (admin) => {
        store.dispatch(updateAdmin(admin));

        const adminName = admin.id === store.getState().user.id ? 'You are' : `${admin.displayName} is`;
        store.dispatch(receiveChat({
          id: uuid(),
          userId: -1,
          text: `${adminName} in control now.`,
          icon: 'ADMIN',
        }));
      },
      [Protocol.FORCE_JOIN]: (room) => {
        store.dispatch(push(`/rooms/${room._id}`));
      },
      [Protocol.JOIN]: (room) => {
        store.dispatch(roomJoined(room.accessCode)); // update socket store
        store.dispatch(roomUpdated(room));

        store.dispatch(createMessage({
          severity: 'success',
          text: 'room joined',
        }));
      },
      [Protocol.USER_JOIN]: (user) => {
        store.dispatch(userJoined(user));

        store.dispatch(receiveChat({
          id: uuid(),
          userId: -1,
          text: `${user.displayName} Joined`,
          icon: 'USER',
        }));
      },
      [Protocol.USER_LEFT]: (user) => {
        store.dispatch(receiveChat({
          id: uuid(),
          userId: -1,
          text: `${store.getState().room.users.find((u) => u.id === user).displayName} Left`,
          icon: 'USER',
        }));

        store.dispatch(userLeft(user));
      },
      [Protocol.NEW_ATTEMPT]: ({ attempt, waitingFor }) => {
        store.dispatch(newAttempt(attempt, waitingFor));

        store.dispatch(receiveChat({
          id: uuid(),
          userId: -1,
          text: 'A new scramble is here',
          secondary: attempt.scrambles.join(', '),
          icon: 'SCRAMBLE',
          event: store.getState().room.event,
        }));
      },
      [Protocol.NEW_RESULT]: (result) => {
        store.dispatch(newResult(result));
      },
      [Protocol.MESSAGE]: (message) => {
        store.dispatch(receiveChat(message));
      },
      [Protocol.UPDATE_STATUS]: ({ user, status }) => {
        store.dispatch(receiveStatus(user, status));
      },
      [Protocol.UPDATE_COMPETING]: ({ userId, competing }) => {
        store.dispatch(updateCompetingForUser(userId, competing));

        const displayName = userId === store.getState().user.id ? 'You are' : `${store.getState().room.users.find((user) => user.id === userId).displayName} is`;
        store.dispatch(receiveChat({
          id: uuid(),
          userId: -1,
          text: `${displayName} ${competing ? 'competing' : 'skipping'}`,
          icon: 'USER',
        }));
      },
      [Protocol.UPDATE_USER_COUNT]: (userCount) => {
        store.dispatch(userCountUpdated(userCount));
      },
    },
  });

  // catch attempt to join room here and then fetch socket event
  const reducers = {
    // no real point in this being here oper other places
    '@@router/LOCATION_CHANGE': ({ payload }) => {
      // TODO: improve
      if (payload.location.pathname === '/' || payload.location.pathname === '/profile') {
        store.dispatch(leaveRoom());
        document.title = 'Let\'s Cube';
      }
    },
    [CONNECT_SOCKET]: () => {
      socket.connect();
    },
    [DISCONNECT_SOCKET]: () => {
      socket.disconnect();
    },
    [FETCH_ROOM]: ({ id }) => {
      socket.emit(Protocol.FETCH_ROOM, id);
    },
    [DELETE_ROOM]: ({ id }) => {
      socket.emit(Protocol.DELETE_ROOM, id);
    },
    [JOIN_ROOM]: ({ id, password }) => {
      socket.emit(Protocol.JOIN_ROOM, { id, password });
    },
    [CREATE_ROOM]: ({ options }) => {
      socket.emit(Protocol.CREATE_ROOM, options);
    },
    [LEAVE_ROOM]: () => {
      if (store.getState().room._id) {
        socket.emit(Protocol.LEAVE_ROOM);
      }
    },
    [SUBMIT_RESULT]: (event) => {
      socket.emit(Protocol.SUBMIT_RESULT, event.result);
    },
    [REQUEST_SCRAMBLE]: (event) => {
      socket.emit(Protocol.REQUEST_SCRAMBLE, event.result);
    },
    [CHANGE_EVENT]: ({ event }) => {
      socket.emit(Protocol.CHANGE_EVENT, event);
    },
    [EDIT_ROOM]: ({ options }) => {
      socket.emit(Protocol.EDIT_ROOM, options);
    },
    [SEND_CHAT]: ({ message }) => {
      socket.emit(Protocol.MESSAGE, message);
    },
    [SEND_STATUS]: ({ status }) => {
      socket.emit(Protocol.UPDATE_STATUS, {
        user: store.getState().user.id,
        status,
      });
    },
    [UPDATE_COMPETING]: ({ competing }) => {
      socket.emit(Protocol.UPDATE_COMPETING, competing);
    },
  };

  // Return the handler that will be called for each action dispatched
  return (next) => (action) => {
    if (reducers[action.type]) {
      reducers[action.type](action);
    }
    next(action); // This is a middleware, we still need to call this!
  };
};

export default socketMiddleware;
