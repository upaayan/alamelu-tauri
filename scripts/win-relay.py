#!/usr/bin/env python3
import sys
import time
import boto3

def run_relay(script_body, timeout=120):
    s3 = boto3.client("s3", region_name="ap-south-1")
    bucket = "sudhir-windows-relay"
    run_id = f"relay_{int(time.time())}_{sys.argv[1] if len(sys.argv) > 1 else 'cmd'}"
    cmd_key = f"relay_cmd_{run_id}.sh"
    resp_key = f"relay_response_{run_id}.txt"

    print(f"[relay] Uploading {cmd_key} to s3://{bucket}...")
    s3.put_object(Bucket=bucket, Key=cmd_key, Body=script_body.encode("utf-8"))

    start = time.time()
    response_text = None
    while time.time() - start < timeout:
        time.sleep(3)
        try:
            resp = s3.get_object(Bucket=bucket, Key=resp_key)
            response_text = resp["Body"].read().decode("utf-8", errors="replace")
            print(f"[relay] Response received in {int(time.time() - start)}s:")
            print("=" * 60)
            print(response_text)
            print("=" * 60)
            break
        except Exception as e:
            if "NoSuchKey" not in str(e):
                print(f"[relay] Polling error: {e}")

    # Cleanup
    try:
        s3.delete_object(Bucket=bucket, Key=cmd_key)
        if response_text is not None:
            s3.delete_object(Bucket=bucket, Key=resp_key)
            s3.delete_object(Bucket=bucket, Key=f"claims/{run_id}")
    except Exception as e:
        print(f"[relay] Cleanup notice: {e}")

    if response_text is None:
        raise TimeoutError(f"Timed out waiting for {resp_key}")
    return response_text

if __name__ == "__main__":
    if len(sys.argv) > 2:
        with open(sys.argv[2], "r") as f:
            content = f.read()
    else:
        content = sys.stdin.read()
    run_relay(content)
