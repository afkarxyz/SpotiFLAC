import { useState, useEffect } from 'react';
export function useTypingEffect(texts: string[], typingSpeed: number = 50, deletingSpeed: number = 50, pauseDuration: number = 1500) {
    const [displayedText, setDisplayedText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [textIndex, setTextIndex] = useState(0);
    useEffect(() => {
        setDisplayedText("");
        setIsDeleting(false);
        setTextIndex(0);
    }, [texts]);
    useEffect(() => {
        const currentText = texts[textIndex % texts.length];
        let timer: ReturnType<typeof setTimeout>;
        if (isDeleting) {
            timer = setTimeout(() => {
                setDisplayedText((prev) => prev.substring(0, prev.length - 1));
            }, deletingSpeed);
        }
        else {
            timer = setTimeout(() => {
                setDisplayedText((prev) => currentText.substring(0, prev.length + 1));
            }, typingSpeed);
        }
        if (!isDeleting && displayedText === currentText) {
            clearTimeout(timer);
            timer = setTimeout(() => setIsDeleting(true), pauseDuration);
        }
        else if (isDeleting && displayedText === '') {
            setIsDeleting(false);
            setTextIndex((prev) => (prev + 1) % texts.length);
        }
        return () => clearTimeout(timer);
    }, [displayedText, isDeleting, textIndex, texts, typingSpeed, deletingSpeed, pauseDuration]);
    return displayedText;
}
