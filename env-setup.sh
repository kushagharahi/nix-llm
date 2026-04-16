#!/usr/bin/env bash 

# Function to parse arguments and set up common variables
parse_args() {
    USE_AMD=false
    USE_METAL=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --amd)
                USE_AMD=true
                shift
                ;;
            --metal)
                USE_METAL=true
                shift
                ;;
            *) # Ignore unknown arguments or model aliases for now to simplify discovery mode. 
               # If we want to support specific models, they can be passed as flags later.
               shift
               ;;
        esac
    done

    # Set environment variables based on GPU mode if USE_AMD is set (passed from caller)
    if [[ "$USE_AMD" == true ]]; then
        export GPU_ENABLE_WGP_MODE=0
        export HIP_VISIBLE_DEVICES=0
    elif [[ "$USE_METAL" == false ]]; then
        export AMD_VULKAN_ICD=RADV
    fi

    export LLAMA_ARG_N_PARALLEL=1
    export LLAMA_COMMON_ARGS="--models-dir ./models --models-preset models.ini --models-max 1"
}