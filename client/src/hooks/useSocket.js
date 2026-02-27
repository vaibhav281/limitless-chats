import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const socketUrl = import.meta.env.VITE_API_BASE ? import.meta.env.VITE_API_BASE.replace('/api/v1', '') : undefined;
const socket = io(socketUrl);

export default function useSocket(userId, username) {
    const [activeUsers, setActiveUsers] = useState([]);

    useEffect(() => {
        const registerUser = () => {
            if (username && userId) {
                socket.emit("register", { userId, username });
            }
        };

        if (socket.connected) {
            registerUser();
        }

        socket.on("connect", registerUser);

        return () => {
            socket.off("connect", registerUser);
        };
    }, [username, userId]);

    useEffect(() => {
        socket.on('activeUsers', (users) => {
            setActiveUsers(users);
        });

        return () => {
            socket.off('activeUsers');
        };
    }, []);

    return { socket, activeUsers };
}
