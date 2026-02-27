import { useState, useEffect, useCallback, useRef } from 'react';

export default function useEmojiPicker() {
    const [isOpen, setIsOpen] = useState(false);
    const pickerRef = useRef(null);
    const buttonRef = useRef(null);

    const togglePicker = useCallback(() => {
        setIsOpen(prev => !prev);
    }, []);

    const closePicker = useCallback(() => {
        setIsOpen(false);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (event) => {
            // Don't close if clicking inside the picker OR the toggle button itself
            if (
                pickerRef.current &&
                !pickerRef.current.contains(event.target) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target)
            ) {
                closePicker();
            }
        };

        const handleEsc = (event) => {
            if (event.key === 'Escape') closePicker();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen, closePicker]);

    return {
        isOpen,
        togglePicker,
        closePicker,
        pickerRef,
        buttonRef
    };
}
