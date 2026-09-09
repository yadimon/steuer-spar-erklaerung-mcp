static void verifyPipePeer(HANDLE pipe, HANDLE target, DWORD pid, std::uint64_t creationTime) {
    ULONG server = 0;
    FILETIME created{}, exited{}, kernel{}, user{};
    if (!GetNamedPipeServerProcessId(pipe, &server) || server != pid
        || GetProcessId(target) != pid || WaitForSingleObject(target, 0) != WAIT_TIMEOUT
        || !GetProcessTimes(target, &created, &exited, &kernel, &user)
        || ((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime) != creationTime)
        throw std::runtime_error("Native pipe OS peer does not match the bound live process");
}
