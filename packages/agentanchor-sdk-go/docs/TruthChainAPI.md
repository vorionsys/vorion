# \TruthChainAPI

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CreateTruthChainRecord**](TruthChainAPI.md#CreateTruthChainRecord) | **Post** /truth-chain | Create truth chain record
[**ListTruthChainRecords**](TruthChainAPI.md#ListTruthChainRecords) | **Get** /truth-chain | List truth chain records
[**VerifyTruthChainRecord**](TruthChainAPI.md#VerifyTruthChainRecord) | **Get** /truth-chain/verify/{hash} | Verify record



## CreateTruthChainRecord

> CreateTruthChainRecord201Response CreateTruthChainRecord(ctx).CreateTruthChainRecordRequest(createTruthChainRecordRequest).Execute()

Create truth chain record



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	createTruthChainRecordRequest := *openapiclient.NewCreateTruthChainRecordRequest("RecordType_example", map[string]interface{}(123)) // CreateTruthChainRecordRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.TruthChainAPI.CreateTruthChainRecord(context.Background()).CreateTruthChainRecordRequest(createTruthChainRecordRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `TruthChainAPI.CreateTruthChainRecord``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateTruthChainRecord`: CreateTruthChainRecord201Response
	fmt.Fprintf(os.Stdout, "Response from `TruthChainAPI.CreateTruthChainRecord`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateTruthChainRecordRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createTruthChainRecordRequest** | [**CreateTruthChainRecordRequest**](CreateTruthChainRecordRequest.md) |  | 

### Return type

[**CreateTruthChainRecord201Response**](CreateTruthChainRecord201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListTruthChainRecords

> ListTruthChainRecords200Response ListTruthChainRecords(ctx).AgentId(agentId).RecordType(recordType).Limit(limit).Execute()

List truth chain records



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	agentId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	recordType := "recordType_example" // string |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.TruthChainAPI.ListTruthChainRecords(context.Background()).AgentId(agentId).RecordType(recordType).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `TruthChainAPI.ListTruthChainRecords``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListTruthChainRecords`: ListTruthChainRecords200Response
	fmt.Fprintf(os.Stdout, "Response from `TruthChainAPI.ListTruthChainRecords`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListTruthChainRecordsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agentId** | **string** |  | 
 **recordType** | **string** |  | 
 **limit** | **int32** |  | [default to 50]

### Return type

[**ListTruthChainRecords200Response**](ListTruthChainRecords200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## VerifyTruthChainRecord

> VerificationResult VerifyTruthChainRecord(ctx, hash).Execute()

Verify record



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	hash := "hash_example" // string | SHA-256 hash of the record

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.TruthChainAPI.VerifyTruthChainRecord(context.Background(), hash).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `TruthChainAPI.VerifyTruthChainRecord``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `VerifyTruthChainRecord`: VerificationResult
	fmt.Fprintf(os.Stdout, "Response from `TruthChainAPI.VerifyTruthChainRecord`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**hash** | **string** | SHA-256 hash of the record | 

### Other Parameters

Other parameters are passed through a pointer to a apiVerifyTruthChainRecordRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**VerificationResult**](VerificationResult.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

