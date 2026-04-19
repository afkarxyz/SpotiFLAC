import { useEffect, useState } from "react";
import { API_SOURCES, checkAllApiStatuses, getApiStatusState, subscribeApiStatus, } from "@/lib/api-status";
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
        checkAll: () => checkAllApiStatuses(false),
    };
}
