#!/usr/bin/env zsh
set -e

gpu_info=$(nvidia-smi -q -x 2>/dev/null | python3 -c "
import sys, json, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
root = tree.getroot()
gpu = root.find('gpu')
print(json.dumps({
    'driver_version': root.findtext('driver_version'),
    'cuda_version': root.findtext('cuda_version'),
    'gpu_name': gpu.findtext('product_name'),
    'architecture': gpu.findtext('product_architecture'),
    'memory_total': gpu.findtext('.//fb_memory_usage/total')
}))
")
echo "$gpu_info" | jq .
driver=$(echo "$gpu_info" | jq -r '.driver_version')
required="596.36"
if printf '%s\n' "$required" "$driver" | sort -V | head -1 | grep -q "^${required}$"; then
    echo "Driver $driver is up to date."
else
    echo "Driver $driver outdated: $required+ required."
    exit 1
fi

if dpkg -l cuda-toolkit-13-2 2>/dev/null | grep -q "^ii"; then
    echo "cuda-toolkit-13-2 already installed, skipping."
else
    echo ""
    echo "This script will install NVIDIA's CUDA keyring and cuda-toolkit-13-2."
    echo "It downloads a .deb from: https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/"
    echo ""
    read -q "REPLY?Do you trust this script to install keyrings and packages? [y/N] " || true
    echo ""
    if [[ "$REPLY" != [yY] ]]; then
        echo "Aborted. Install manually from NVIDIA's official source:"
        echo "  https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_network"
        exit 0
    fi
    if ! dpkg -l cuda-keyring 2>/dev/null | grep -q "^ii"; then
        wget -nc https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
        sudo dpkg -i cuda-keyring_1.1-1_all.deb
    else
        echo "cuda-keyring already installed, skipping."
    fi
    sudo apt-get update
    sudo apt-get -y install cuda-toolkit-13-2
    sudo apt-get -y autoremove
fi

ls /usr/local/cuda/bin 2>/dev/null | grep -q nvcc_ && echo "NVCC Installed" || echo "NVCC Install Failed"

if ! grep -q '/usr/local/cuda/bin' ~/.zshenv 2>/dev/null; then
    cat << 'EOF' >> ~/.zshenv

export PATH=/usr/local/cuda/bin${PATH:+:${PATH}}
export LD_LIBRARY_PATH=/usr/local/cuda/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}
EOF
    echo "CUDA paths added to ~/.zshenv"
else
    echo "CUDA paths already in ~/.zshenv, skipping."
fi

source "$HOME/.zshenv"


cat > /dev/shm/.cuda_test.cu << 'CUDA_SRC'
#include <cstdio>
__global__ void hello() {
    printf("Hello from GPU thread %d in block %d\n", threadIdx.x, blockIdx.x);
}
int main() {
    cudaDeviceProp prop;
    cudaGetDeviceProperties(&prop, 0);
    printf("Device: %s | Compute: %d.%d | Memory: %.1f GB\n",
           prop.name, prop.major, prop.minor, prop.totalGlobalMem / 1073741824.0);
    hello<<<2, 4>>>();
    cudaError_t err = cudaDeviceSynchronize();
    if (err != cudaSuccess) {
        printf("Kernel launch failed: %s\n", cudaGetErrorString(err));
        return 1;
    }
    return 0;
}
CUDA_SRC

nvcc -o /dev/shm/.cuda_test /dev/shm/.cuda_test.cu && \
output=$(/dev/shm/.cuda_test 2>&1) && \
echo "$output" | head -1 && \
if echo "$output" | grep -q "Hello from GPU thread"; then
    echo "CUDA toolkit works"
else
    echo "CUDA kernel did not produce expected output"
fi
rm -f /dev/shm/.cuda_test /dev/shm/.cuda_test.cu
