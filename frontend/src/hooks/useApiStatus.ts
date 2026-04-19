import { useEffect, useState } from "react";
import { API_SOURCES, checkApiStatus, getApiStatusState, subscribeApiStatus, } from "@/lib/api-status";
export function useApiStatus() {
    const [state, setState] = useState(getApiStatusState);
    useEffect(() => {
        return subscribeApiStatus(() => {
            setState(getApiStatusState());
        });
    }, []);
    return {
        ...state,
        sources: API_SOURCES,
        checkOne: (sourceId: string) => checkApiStatus(sourceId),
    };
}
