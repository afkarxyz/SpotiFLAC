export const CHECK_TIMEOUT_MS = 10 * 1000;
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number = CHECK_TIMEOUT_MS, message: string = `Operation timed out after ${Math.round(timeoutMs / 1000)} seconds`): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);
        promise
            .then((value) => {
            window.clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            window.clearTimeout(timer);
            reject(error);
        });
    });
}
