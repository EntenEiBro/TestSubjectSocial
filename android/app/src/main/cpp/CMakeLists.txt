# JNI glue between EosBridge.java and the Epic Online Services SDK.
# The SDK itself is not in this repository: build.gradle unpacks the EOS AAR
# (EOS/android/SDK/...) into build/unpacked/eossdk and passes its paths here.
cmake_minimum_required(VERSION 3.22.1)
project(tss_eos C)

add_library(EOSSDK SHARED IMPORTED)
set_property(TARGET EOSSDK PROPERTY IMPORTED_LOCATION ${EOS_AAR_DIR}/jni/${ANDROID_ABI}/libEOSSDK.so)
set_property(TARGET EOSSDK PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${EOS_INCLUDE_DIR})

add_library(tss_eos SHARED tss_eos.c)
find_library(log-lib log)
target_link_libraries(tss_eos EOSSDK ${log-lib})
