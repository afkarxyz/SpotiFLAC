import { useEffect, useState } from "react";
import {
    API_SOURCES,
    checkAllApiStatuses,
    ensureApiStatusCheckStarted,
    getApiStatusState,
    subscribeApiStatus,
} from "@/lib/api-status";

export function useApiStatus() {
    const [state, setState] = useState(getApiStatusState);

    useEffect(() => {
        ensureApiStatusCheckStarted();
        return subscribeApiStatus(() => {
            setState(getApiStatusState());
        });
    }, []);

    return {
        ...state,
        sources: API_SOURCES,
        refreshAll: checkAllApiStatuses,
    };
}
