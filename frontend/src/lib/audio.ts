class AudioManager {
    private audioContext: AudioContext | null = null;
    private getAudioContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return this.audioContext;
    }
    private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.3) {
        try {
            const ctx = this.getAudioContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.frequency.value = frequency;
            oscillator.type = type;
            gainNode.gain.setValueAtTime(volume, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        }
        catch (error) {
            console.error('Error playing audio:', error);
        }
    }
    playSuccess() {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;
        this.playToneAt(523.25, 0.08, 'sine', 0.2, now);
        this.playToneAt(659.25, 0.08, 'sine', 0.2, now + 0.08);
        this.playToneAt(783.99, 0.15, 'sine', 0.25, now + 0.16);
    }
    playError() {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;
        this.playToneAt(392.00, 0.1, 'square', 0.15, now);
        this.playToneAt(329.63, 0.2, 'square', 0.2, now + 0.1);
    }
    playWarning() {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;
        this.playToneAt(440.00, 0.1, 'triangle', 0.2, now);
        this.playToneAt(493.88, 0.1, 'triangle', 0.2, now + 0.12);
    }
    playInfo() {
        this.playTone(523.25, 0.15, 'sine', 0.15);
    }
    private playToneAt(frequency: number, duration: number, type: OscillatorType, volume: number, startTime: number) {
        try {
            const ctx = this.getAudioContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.frequency.value = frequency;
            oscillator.type = type;
            gainNode.gain.setValueAtTime(volume, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        }
        catch (error) {
            console.error('Error playing audio:', error);
        }
    }
}
export const audioManager = new AudioManager();
export const playSuccessSound = () => audioManager.playSuccess();
export const playErrorSound = () => audioManager.playError();
export const playWarningSound = () => audioManager.playWarning();
export const playInfoSound = () => audioManager.playInfo();
